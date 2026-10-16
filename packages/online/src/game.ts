// One browser's view of an online game (docs/v0.3-online-design.md, "The game" and
// "Architecture"): the rules from xiangqi-core, both clocks, draw offers, takebacks, resigning,
// aborting, and noticing that the opponent has gone. It knows nothing of the network: messages
// go out through `Io.send`, come in through `receive`, and every call is given the time, so it
// runs the same in tests. The opponent's browser isn't trusted: its moves are checked, and its
// clock can't claim more than the lag allowance back.
import { type Color, Game } from "xiangqi-core";
import { type Clocks, type LinkMsg, type Phrase, type Report, movesHash } from "./protocol.js";
import { NO_RESULT, type OnlineResult, material, other, winOrDraw } from "./result.js";
import {
  AWAY_AFTER_MS,
  DRAW_MIN_PLIES,
  DRAW_RETRY_MOVES,
  EARLY_CLAIM_AFTER_MS,
  EARLY_CLAIM_MIN_WINDOW_MS,
  FIRST_MOVE_MS,
  LAG_ALLOWANCE_MS,
  LAST_CHANCE_MS,
  MIN_RATED_PLIES,
  type TimeControl,
  reconnectWindowMs,
  speedOf,
  takebackWaitMs,
} from "./timeControl.js";

export interface Io {
  /** To the other browser. */
  send(msg: LinkMsg): void;
  /** To the server's queue. */
  report(r: Report): void;
  /** Something changed: redraw. */
  changed(): void;
  /** The opponent sent a chat phrase. */
  chat?(phrase: Phrase): void;
  /** The two browsers disagree in a way only the server can settle. */
  dispute?(d: Dispute): void;
}

export type Dispute =
  | { kind: "illegal-move"; ply: number; iccs: string }
  | { kind: "out-of-step"; ply: number; hash: string }
  | { kind: "clock"; claimed: number; held: number }
  | { kind: "flag-denied" };

export interface OnlineGameOptions {
  me: Color;
  tc: TimeControl;
  rated: boolean;
  /** Local time the game began (both players connected). */
  now: number;
}

export interface Away {
  /** When the opponent was last heard from. */
  since: number;
  windowMs: number;
  closedTab: boolean;
  /** When the connected player made an early claim (longer games), starting the last 30 s. */
  claimedAt: number | null;
}

export type ClaimState =
  /** Nothing to claim yet. */
  | { kind: "wait"; at: number }
  /** An early claim is possible (longer games, after 1 min). */
  | { kind: "early" }
  /** Claimed early: the opponent has until `until`. */
  | { kind: "last-chance"; until: number }
  /** The window is over: claim the win or a draw now. */
  | { kind: "final" };

export class OnlineGame {
  readonly me: Color;
  readonly opp: Color;
  readonly tc: TimeControl;
  readonly rated: boolean;
  readonly game = new Game();
  /** Milliseconds left, as of `turnStart` for the side to move. */
  readonly clocks: Clocks;
  /** Local time the current turn began (when the move before it was sent or received). */
  turnStart: number;
  result: OnlineResult | null = null;
  /** A draw offer waiting for an answer, and who made it. */
  drawOffer: Color | null = null;
  /** A takeback request waiting for an answer: who asked, and the ply count it goes back to. */
  takeback: { by: Color; plies: number } | null = null;
  away: Away | null = null;
  /** Round trip over the link, from the latest ping. */
  rtt: number | null = null;
  /** Set when the opponent's clock was charged more than their browser said (shown as "adjusted for lag"). */
  lagAdjustedAt: number | null = null;

  private lastHeard: number;
  /** Set once the link to the other browser is up: timers don't run before that. */
  private begun = false;
  private nextDrawOfferAt = 0;
  private takebackRefusals = 0;
  private takebackWaitUntil = 0;
  private readonly lag: number;
  private readonly firstMoveMs: number;

  constructor(
    opts: OnlineGameOptions,
    private readonly io: Io,
  ) {
    this.me = opts.me;
    this.opp = other(opts.me);
    this.tc = opts.tc;
    this.rated = opts.rated;
    this.clocks = { red: opts.tc.base * 1000, black: opts.tc.base * 1000 };
    this.turnStart = opts.now;
    this.lastHeard = opts.now;
    const speed = speedOf(opts.tc);
    this.lag = LAG_ALLOWANCE_MS[speed];
    this.firstMoveMs = FIRST_MOVE_MS[speed];
  }

  // Reading the state ---------------------------------------------------------------------

  get moves(): string[] {
    return this.game.history.map((m) => m.iccs);
  }
  get plies(): number {
    return this.game.history.length;
  }
  get turn(): Color {
    return this.game.turn;
  }
  get hash(): string {
    return movesHash(this.moves);
  }
  /** Whether a side has made a move yet (its clock runs only after its first move). */
  hasMoved(c: Color): boolean {
    return this.plies > (c === "red" ? 0 : 1);
  }
  private movesBy(c: Color): number {
    return Math.floor((this.plies + (c === "red" ? 1 : 0)) / 2);
  }

  /** Time left on a clock now. */
  clock(c: Color, now: number): number {
    const running = !this.result && this.turn === c && this.hasMoved(c);
    return running ? this.clocks[c] - (now - this.turnStart) : this.clocks[c];
  }
  /** Time left for the side to move to make their first move, or null once they have. */
  firstMoveLeft(now: number): number | null {
    if (this.result || this.hasMoved(this.turn)) return null;
    return this.firstMoveMs - (now - this.turnStart);
  }
  /** Whether the result counts for ratings. */
  get ratedResult(): boolean {
    return this.rated && !!this.result && !NO_RESULT.has(this.result.reason) && this.plies >= MIN_RATED_PLIES;
  }

  canAbort(): boolean {
    return !this.result && this.plies < 2;
  }
  canResign(): boolean {
    return !this.result && this.plies >= 2;
  }
  canOfferDraw(): boolean {
    if (this.result || this.drawOffer === this.me) return false;
    if (this.drawOffer === this.opp) return true; // offering back is accepting
    return (!this.rated || this.plies >= DRAW_MIN_PLIES) && this.movesBy(this.me) >= this.nextDrawOfferAt;
  }
  canRequestTakeback(now: number): boolean {
    return !this.rated && !this.result && !this.takeback && this.movesBy(this.me) > 0 && now >= this.takebackWaitUntil;
  }

  // My actions ------------------------------------------------------------------------------

  /** Plays my move (ICCS). Returns false if it's illegal, not my turn, or my time has run out. */
  move(iccs: string, now: number): boolean {
    if (this.result || this.turn !== this.me) return false;
    const moved = this.hasMoved(this.me);
    const used = moved ? now - this.turnStart : 0;
    if (moved && this.clocks[this.me] - used <= 0) {
      this.tick(now);
      return false;
    }
    if (!this.game.move(iccs)) return false;
    if (moved) this.clocks[this.me] += this.tc.inc * 1000 - used;
    this.afterMove(this.me, now);
    this.io.send({ t: "move", ply: this.plies, iccs, clock: this.clocks[this.me], seen: this.clocks[this.opp], hash: this.hash });
    this.reportMove();
    this.checkRules();
    this.io.changed();
    return true;
  }

  resign(now: number) {
    if (!this.canResign()) return;
    this.io.send({ t: "resign" });
    this.end({ winner: this.opp, reason: "resign" }, now);
  }

  abort(now: number) {
    if (!this.canAbort()) return;
    this.io.send({ t: "abort" });
    this.end({ winner: null, reason: "aborted", by: this.me }, now);
  }

  offerDraw(now: number) {
    if (!this.canOfferDraw()) return;
    if (this.drawOffer === this.opp) return this.acceptDraw(now);
    this.drawOffer = this.me;
    this.nextDrawOfferAt = this.movesBy(this.me) + DRAW_RETRY_MOVES;
    this.io.send({ t: "offer-draw" });
    this.io.changed();
  }

  acceptDraw(now: number) {
    if (this.result || this.drawOffer !== this.opp) return;
    this.io.send({ t: "accept-draw" });
    this.end({ winner: null, reason: "agreement" }, now);
  }

  declineDraw() {
    if (this.drawOffer !== this.opp) return;
    this.drawOffer = null;
    this.io.send({ t: "decline-draw" });
    this.io.changed();
  }

  /** Casual games: asks to take back my last move (and the opponent's reply, if they've made it). */
  requestTakeback(now: number) {
    if (!this.canRequestTakeback(now)) return;
    const plies = this.plies - (this.turn === this.me ? 2 : 1);
    this.takeback = { by: this.me, plies };
    this.io.send({ t: "takeback", plies });
    this.io.changed();
  }

  acceptTakeback(now: number) {
    if (this.result || this.takeback?.by !== this.opp) return;
    const { plies } = this.takeback;
    this.io.send({ t: "accept-takeback", plies });
    this.goBackTo(plies, now);
  }

  declineTakeback() {
    if (this.takeback?.by !== this.opp) return;
    this.takeback = null;
    this.io.send({ t: "decline-takeback" });
    this.io.changed();
  }

  sendChat(phrase: Phrase) {
    this.io.send({ t: "chat", phrase });
  }

  /** Sent every couple of seconds over a direct link; it measures the round trip too. */
  ping(now: number) {
    this.io.send({ t: "ping", at: now });
  }

  /** The page is closing: the opponent's wait is cut to 10 s. */
  bye() {
    this.io.send({ t: "bye" });
  }

  /** After the link is (re)made: tells the other browser how far this one has got. */
  hello() {
    this.io.send({ t: "hello", plies: this.plies, hash: this.hash });
  }

  /** Whether and how I can claim, with the opponent away. */
  claimState(now: number): ClaimState | null {
    const a = this.away;
    if (!a || this.result) return null;
    const end = a.since + a.windowMs;
    if (now >= end) return { kind: "final" };
    if (a.claimedAt !== null) return { kind: "last-chance", until: Math.min(end, a.claimedAt + LAST_CHANCE_MS) };
    if (a.windowMs > EARLY_CLAIM_MIN_WINDOW_MS) {
      return now >= a.since + EARLY_CLAIM_AFTER_MS ? { kind: "early" } : { kind: "wait", at: a.since + EARLY_CLAIM_AFTER_MS };
    }
    return { kind: "wait", at: end };
  }

  /** Claims the win with the opponent away: at once if their window is over, else it starts their last 30 s. */
  claimWin(now: number) {
    const s = this.claimState(now);
    if (s?.kind === "final") this.end(winOrDraw(this.game, this.me, "abandoned", this.opp), now);
    else if (s?.kind === "early" && this.away) {
      this.away.claimedAt = now;
      this.io.changed();
    }
  }

  /** Claims a draw once the opponent's window is over. */
  claimDraw(now: number) {
    if (this.claimState(now)?.kind === "final") this.end({ winner: null, reason: "claim-draw", by: this.opp }, now);
  }

  /**
   * The link to the other browser is up (call each time it comes up). The first time, the
   * first-move timer starts from now, so time spent loading pages and connecting isn't counted.
   */
  begin(now: number) {
    this.lastHeard = now;
    if (this.begun) return;
    this.begun = true;
    if (this.plies === 0) this.turnStart = now;
  }

  /** The server settled the game (a dispute, or the other browser's claim): its word is final. */
  adopt(result: OnlineResult, now: number) {
    if (!this.result) return this.end(result, now);
    this.result = result;
    this.io.changed();
  }

  // Time passing ----------------------------------------------------------------------------

  /** Call a few times a second: runs out clocks and timers, and notices an opponent gone quiet. */
  tick(now: number) {
    if (this.result || !this.begun) return;
    const side = this.turn;
    // The opponent's time is up only after the lag allowance, so a move already on its way counts.
    const grace = side === this.opp ? this.lag : 0;
    if (!this.hasMoved(side)) {
      if (now - this.turnStart > this.firstMoveMs + grace) {
        if (side === this.opp) this.io.send({ t: "flag" });
        return this.end({ winner: null, reason: "aborted", by: side }, now);
      }
    } else if (this.clock(side, now) <= -grace) {
      if (side === this.opp) this.io.send({ t: "flag" });
      this.clocks[side] = 0;
      return this.end(winOrDraw(this.game, other(side), "timeout"), now);
    }

    if (!this.away && now - this.lastHeard > AWAY_AFTER_MS) this.goneQuiet(this.lastHeard, false, now);
    if (this.away?.claimedAt != null && now >= Math.min(this.away.since + this.away.windowMs, this.away.claimedAt + LAST_CHANCE_MS)) {
      this.end(winOrDraw(this.game, this.me, "abandoned", this.opp), now);
    }
  }

  private goneQuiet(since: number, closedTab: boolean, now: number) {
    const m = material(this.game);
    const downMaterial = m[this.opp] <= m[this.me] - 4;
    this.away = { since, windowMs: reconnectWindowMs(this.tc, { downMaterial, closedTab }), closedTab, claimedAt: null };
    this.io.report({ kind: "away", ms: now - since });
    this.io.changed();
  }

  // Messages from the other browser ------------------------------------------------------

  /** A sign of life that isn't a message (in a relayed game, the opponent is still on the channel). */
  alive(now: number) {
    this.lastHeard = now;
    if (this.away) {
      this.away = null;
      this.io.report({ kind: "back" });
      this.io.changed();
    }
  }

  receive(msg: LinkMsg, now: number) {
    if (msg.t === "bye") this.lastHeard = now;
    else this.alive(now);
    switch (msg.t) {
      case "ping":
        return this.io.send({ t: "pong", at: msg.at });
      case "pong":
        this.rtt = Math.max(0, now - msg.at);
        return;
      case "hello":
        return this.onHello(msg, now);
      case "sync":
        return this.onSync(msg, now);
    }
    if (this.result) return;
    switch (msg.t) {
      case "move":
        return this.onMove(msg, now);
      case "resign":
        if (this.canResign()) this.end({ winner: this.me, reason: "resign" }, now);
        return;
      case "abort":
        if (this.canAbort()) this.end({ winner: null, reason: "aborted", by: this.opp }, now);
        return;
      case "offer-draw":
        if (this.drawOffer === this.me) return this.end({ winner: null, reason: "agreement" }, now);
        // A rated offer before 10 moves each is ignored, as the site never sends one.
        if (!this.rated || this.plies >= DRAW_MIN_PLIES) this.drawOffer = this.opp;
        return this.io.changed();
      case "accept-draw":
        if (this.drawOffer === this.me) this.end({ winner: null, reason: "agreement" }, now);
        return;
      case "decline-draw":
        if (this.drawOffer === this.me) this.drawOffer = null;
        return this.io.changed();
      case "takeback":
        // Back to a position where it's their move again: their last move, and my reply if made.
        const theirTurnThen = (msg.plies % 2 === 0 ? "red" : "black") === this.opp;
        if (!this.rated && !this.takeback && theirTurnThen && msg.plies >= 0 && msg.plies < this.plies && this.plies - msg.plies <= 2) {
          this.takeback = { by: this.opp, plies: msg.plies };
          this.io.changed();
        }
        return;
      case "accept-takeback":
        if (this.takeback?.by === this.me && this.takeback.plies === msg.plies) this.goBackTo(msg.plies, now);
        return;
      case "decline-takeback":
        if (this.takeback?.by === this.me) {
          this.takeback = null;
          this.takebackRefusals++;
          this.takebackWaitUntil = now + takebackWaitMs(this.takebackRefusals);
          this.io.changed();
        }
        return;
      case "chat":
        return this.io.chat?.(msg.phrase);
      case "flag":
        // My own clock decides for me; if it hasn't run out here, the server settles it.
        this.tick(now);
        if (!this.result) this.io.dispute?.({ kind: "flag-denied" });
        return;
      case "bye":
        if (!this.away) this.goneQuiet(now, true, now);
        return;
    }
  }

  private onMove(msg: Extract<LinkMsg, { t: "move" }>, now: number) {
    if (msg.ply <= this.plies && this.hash === msg.hash) return; // already have it
    if (msg.ply !== this.plies + 1 || this.turn !== this.opp) return this.io.dispute?.({ kind: "out-of-step", ply: msg.ply, hash: msg.hash });

    const moved = this.hasMoved(this.opp);
    const before = this.clocks[this.opp];
    // Charged: what their browser says it used, but at least what I saw less the lag allowance.
    const observed = now - this.turnStart;
    const claimed = moved ? before + this.tc.inc * 1000 - msg.clock : 0;
    const charged = moved ? Math.max(claimed, observed - this.lag, 0) : 0;
    if (moved && before - charged <= 0) {
      // Arrived after their time ran out here, allowance included.
      this.io.send({ t: "flag" });
      this.clocks[this.opp] = 0;
      return this.end(winOrDraw(this.game, this.me, "timeout"), now);
    }
    if (!this.game.move(msg.iccs)) return this.io.dispute?.({ kind: "illegal-move", ply: msg.ply, iccs: msg.iccs });
    if (this.hash !== msg.hash) {
      this.game.undo();
      return this.io.dispute?.({ kind: "out-of-step", ply: msg.ply, hash: msg.hash });
    }
    if (moved) {
      this.clocks[this.opp] = before - charged + this.tc.inc * 1000;
      if (charged - claimed > 100) this.lagAdjustedAt = now;
    }
    // Their view of my clock may be lower than mine: my last move took a round trip longer than
    // the allowance to reach them. More than a round trip's worth would be made up.
    if (msg.seen < this.clocks[this.me]) {
      const credible = 1.5 * Math.max(this.rtt ?? 0, 1000) + this.lag;
      if (this.clocks[this.me] - msg.seen <= credible) this.clocks[this.me] = msg.seen;
      else this.io.dispute?.({ kind: "clock", claimed: msg.seen, held: this.clocks[this.me] });
    }
    this.afterMove(this.opp, now);
    this.reportMove();
    this.checkRules();
    this.io.changed();
  }

  private onHello(msg: Extract<LinkMsg, { t: "hello" }>, now: number) {
    // The browser that's further on sends the game; one that's equal says nothing more.
    if (msg.plies < this.plies || (this.result && msg.plies <= this.plies)) {
      this.io.send({ t: "sync", moves: this.moves, clocks: { ...this.clocks }, elapsed: now - this.turnStart, result: this.result });
    } else if (msg.plies === this.plies && msg.hash !== this.hash) {
      this.io.dispute?.({ kind: "out-of-step", ply: msg.plies, hash: msg.hash });
    }
  }

  /** Takes the game from the other browser, which is further on (this page reloaded, or missed moves). */
  private onSync(msg: Extract<LinkMsg, { t: "sync" }>, now: number) {
    if (msg.moves.length < this.plies) return;
    const mine = this.moves;
    if (mine.some((m, i) => msg.moves[i] !== m)) return this.io.dispute?.({ kind: "out-of-step", ply: this.plies, hash: movesHash(msg.moves) });
    for (const m of msg.moves.slice(mine.length)) {
      if (!this.game.move(m)) return this.io.dispute?.({ kind: "illegal-move", ply: this.plies + 1, iccs: m });
    }
    this.clocks.red = msg.clocks.red;
    this.clocks.black = msg.clocks.black;
    this.turnStart = now - Math.max(0, msg.elapsed);
    this.drawOffer = null;
    this.takeback = null;
    if (msg.result) this.end(msg.result, now);
    else this.checkRules();
    this.io.changed();
  }

  // Shared steps ----------------------------------------------------------------------------

  private afterMove(mover: Color, now: number) {
    this.turnStart = now;
    // A move declines the other side's draw offer or takeback request.
    if (this.drawOffer === other(mover)) this.drawOffer = null;
    if (this.takeback?.by === other(mover)) this.takeback = null;
  }

  private reportMove() {
    const last = this.game.history.at(-1)!;
    this.io.report({ kind: "move", ply: this.plies, iccs: last.iccs, clocks: { ...this.clocks }, hash: this.hash });
  }

  private checkRules() {
    const r = this.game.result;
    if (r && !this.result) this.end({ winner: r.winner, reason: r.reason }, this.turnStart);
  }

  private goBackTo(plies: number, now: number) {
    while (this.plies > plies) this.game.undo();
    this.takeback = null;
    this.drawOffer = null;
    this.turnStart = now;
    this.io.changed();
  }

  private end(result: OnlineResult, now: number) {
    if (this.result) return;
    // Freeze the running clock where it stands.
    const side = this.turn;
    if (this.hasMoved(side)) this.clocks[side] = Math.max(0, this.clocks[side] - (now - this.turnStart));
    this.result = result;
    this.drawOffer = null;
    this.takeback = null;
    this.away = null;
    this.io.report({ kind: "end", result, moves: this.moves, clocks: { ...this.clocks } });
    this.io.changed();
  }
}
