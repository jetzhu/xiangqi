import { describe, expect, it } from "vitest";
import { Game } from "xiangqi-core";
import { type Dispute, type LinkMsg, OnlineGame, type Report, type TimeControl, parseLinkMsg } from "../src/index.js";

/** Two browsers joined by a pretend link with a one-way delay, on a shared pretend clock. */
function pair(tc: TimeControl = { base: 300, inc: 3 }, opts: { rated?: boolean; delay?: number } = {}) {
  let now = 0;
  const delay = opts.delay ?? 50;
  const queue: { at: number; to: "red" | "black"; msg: LinkMsg }[] = [];
  const reports = { red: [] as Report[], black: [] as Report[] };
  const disputes = { red: [] as Dispute[], black: [] as Dispute[] };
  let linkUp = true;
  const make = (me: "red" | "black") =>
    new OnlineGame(
      { me, tc, rated: opts.rated ?? true, now },
      {
        // Through JSON and the parser, as over the real link.
        send: (msg) => linkUp && queue.push({ at: now + delay, to: me === "red" ? "black" : "red", msg: parseLinkMsg(JSON.stringify(msg))! }),
        report: (r) => reports[me].push(r),
        changed: () => {},
        dispute: (d) => disputes[me].push(d),
      },
    );
  const g = { red: make("red"), black: make("black") };
  g.red.begin(now);
  g.black.begin(now);
  /** Moves time forward to `t`, delivering messages and ticking both browsers on the way. */
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const next = queue[0];
      const step = Math.min(end, next && next.at <= end ? next.at : end, now + 100);
      now = step;
      while (queue[0] && queue[0].at <= now) {
        const q = queue.shift()!;
        g[q.to].receive(q.msg, now);
      }
      g.red.tick(now);
      g.black.tick(now);
      if (now >= end) break;
    }
  };
  return {
    g,
    reports,
    disputes,
    advance,
    get now() {
      return now;
    },
    set linkUp(v: boolean) {
      linkUp = v;
    },
    /** Plays moves alternately, each after `think` ms, waiting for each to arrive. */
    play(moves: string[], think = 1000) {
      for (const m of moves) {
        advance(think);
        const side = g.red.turn;
        expect(g[side].move(m, now), `${side} ${m}`).toBe(true);
        advance(delay);
      }
    },
  };
}

// A short opening, legal move by move.
const OPENING = ["h2e2", "h9g7", "h0g2", "i9h9", "i0h0", "b9c7", "b0c2", "g6g5"];

/** Seeded random legal moves after OPENING that don't end the game, `n` plies in all. */
function line(n: number, seed = 7): string[] {
  const g = new Game();
  for (const m of OPENING) g.move(m);
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  while (g.history.length < n) {
    const ms = g.legalMoves();
    const m = ms[Math.floor(rand() * ms.length)]!;
    g.move(m);
    if (g.result) g.undo();
  }
  return g.history.map((h) => h.iccs);
}
const TWENTY = line(20);

describe("moves and clocks", () => {
  it("plays moves on both boards and keeps the hashes equal", () => {
    const p = pair();
    p.play(OPENING);
    expect(p.g.red.moves).toEqual(OPENING);
    expect(p.g.black.moves).toEqual(OPENING);
    expect(p.g.red.hash).toBe(p.g.black.hash);
    expect(p.reports.red.filter((r) => r.kind === "move")).toHaveLength(OPENING.length);
  });

  it("starts each clock at the first move, adds the increment, and both browsers agree", () => {
    const p = pair({ base: 300, inc: 3 });
    p.play(OPENING, 2000);
    // Each side: first move free, then 3 moves of 2 s (plus delays within the allowance) with 3 s added.
    for (const c of ["red", "black"] as const) {
      expect(p.g.red.clocks[c]).toBe(p.g.black.clocks[c]);
      expect(p.g.red.clocks[c]).toBeGreaterThan(300_000 + 3 * 1000 - 200);
    }
  });

  it("refuses an illegal move and a move out of turn", () => {
    const p = pair();
    expect(p.g.red.move("a0a5", 0)).toBe(false);
    expect(p.g.black.move("h9g7", 0)).toBe(false);
  });

  it("charges a move at least what the opponent saw, less the lag allowance", () => {
    const p = pair({ base: 180, inc: 2 }, { delay: 1000 }); // blitz: 300 ms allowance, 1 s each way
    p.play(OPENING.slice(0, 4), 500);
    p.advance(500);
    p.g.red.move("i0h0", p.now);
    p.advance(1000);
    // Red thought 0.5 s by its own clock, but Black waited 0.5 + 2 s round trip for it.
    expect(p.g.black.clocks.red).toBeLessThan(p.g.red.clocks.red);
    expect(p.g.black.lagAdjustedAt).not.toBeNull();
    // Black's next move tells Red, and Red takes Black's lower figure.
    p.advance(100);
    p.g.black.move("b9c7", p.now);
    p.advance(1000);
    expect(p.g.red.clocks.red).toBe(p.g.black.clocks.red);
  });

  it("ends the game when a clock runs out, on both boards", () => {
    const p = pair({ base: 60, inc: 0 });
    p.play(OPENING.slice(0, 3), 500);
    // Black's clock runs (Black has moved); Black never moves again.
    p.advance(61_000);
    for (const g of [p.g.red, p.g.black]) expect(g.result).toEqual({ winner: "red", reason: "timeout" });
    expect(p.g.black.clocks.black).toBe(0);
  });

  it("aborts, unrated, when the first move doesn't come in time", () => {
    const p = pair({ base: 300, inc: 3 });
    p.advance(31_000);
    expect(p.g.red.result).toEqual({ winner: null, reason: "aborted" });
    expect(p.g.black.result).toEqual({ winner: null, reason: "aborted" });
    expect(p.g.red.ratedResult).toBe(false);
  });

  it("starts the first-move timer only once the link is up", () => {
    const io = { send: () => {}, report: () => {}, changed: () => {} };
    const g = new OnlineGame({ me: "red", tc: { base: 120, inc: 1 }, rated: true, now: 0 }, io);
    g.tick(60_000); // a minute of loading and connecting
    expect(g.result).toBeNull();
    expect(g.away).toBeNull();
    g.begin(60_000);
    expect(g.firstMoveLeft(65_000)).toBe(15_000);
    g.tick(80_500);
    expect(g.result?.reason).toBe("aborted");
  });

  it("ends both boards when the rules end the game", () => {
    const p = pair({ base: 3600, inc: 30 });
    const g = new Game();
    let seed = 3;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    while (!g.result) {
      const ms = g.legalMoves();
      g.move(ms[Math.floor(rand() * ms.length)]!);
    }
    p.play(g.history.map((h) => h.iccs), 50);
    expect(p.g.red.result).toEqual({ winner: g.result!.winner, reason: g.result!.reason });
    expect(p.g.black.result).toEqual(p.g.red.result);
    expect(p.reports.red.at(-1)?.kind).toBe("end");
  });
});

describe("resign, abort, draw", () => {
  it("resigns, once both have moved", () => {
    const p = pair();
    expect(p.g.red.canResign()).toBe(false);
    p.play(OPENING.slice(0, 2));
    p.g.black.resign(p.now);
    p.advance(100);
    expect(p.g.red.result).toEqual({ winner: "red", reason: "resign" });
    expect(p.g.black.result).toEqual({ winner: "red", reason: "resign" });
  });

  it("aborts before both have moved, not after", () => {
    const p = pair();
    p.play(OPENING.slice(0, 1));
    expect(p.g.black.canAbort()).toBe(true);
    p.g.black.abort(p.now);
    p.advance(100);
    expect(p.g.red.result?.reason).toBe("aborted");
    const q = pair();
    q.play(OPENING.slice(0, 2));
    expect(q.g.red.canAbort()).toBe(false);
  });

  it("allows rated draw offers from 10 moves each, and a move declines one", () => {
    const p = pair();
    p.play(OPENING);
    expect(p.g.red.canOfferDraw()).toBe(false);
    p.play(TWENTY.slice(OPENING.length));
    expect(p.g.red.plies).toBe(20);
    p.g.red.offerDraw(p.now);
    p.advance(100);
    expect(p.g.black.drawOffer).toBe("red");
    // Red moves; Black replies instead of answering, which declines it.
    const more = line(22);
    p.play(more.slice(20, 21));
    expect(p.g.black.drawOffer).toBe("red");
    p.play(more.slice(21, 22));
    expect(p.g.red.drawOffer).toBeNull();
    expect(p.g.black.drawOffer).toBeNull();
    // Red waits 10 of its own moves before offering again.
    expect(p.g.red.canOfferDraw()).toBe(false);
  });

  it("agrees a draw", () => {
    const p = pair({ base: 300, inc: 3 }, { rated: false });
    p.play(OPENING.slice(0, 2));
    p.g.red.offerDraw(p.now);
    p.advance(100);
    p.g.black.acceptDraw(p.now);
    p.advance(100);
    expect(p.g.red.result).toEqual({ winner: null, reason: "agreement" });
    expect(p.g.black.result).toEqual({ winner: null, reason: "agreement" });
    expect(p.g.red.ratedResult).toBe(false);
  });

  it("ignores a rated draw offer sent too early by a modified browser", () => {
    const p = pair();
    p.play(OPENING.slice(0, 2));
    p.g.black.receive({ t: "offer-draw" }, p.now);
    expect(p.g.black.drawOffer).toBeNull();
  });
});

describe("takebacks", () => {
  it("takes back in casual games, with longer waits after each refusal", () => {
    const p = pair({ base: 300, inc: 3 }, { rated: false });
    p.play(OPENING.slice(0, 3));
    // Red asks after Black has replied? No: Red just moved, so only Red's move goes back.
    p.g.red.requestTakeback(p.now);
    p.advance(100);
    expect(p.g.black.takeback).toEqual({ by: "red", plies: 2 });
    p.g.black.declineTakeback();
    p.advance(100);
    expect(p.g.red.canRequestTakeback(p.now)).toBe(false);
    p.advance(10_000);
    expect(p.g.red.canRequestTakeback(p.now)).toBe(true);
    p.g.red.requestTakeback(p.now);
    p.advance(100);
    p.g.black.acceptTakeback(p.now);
    p.advance(100);
    expect(p.g.red.moves).toEqual(OPENING.slice(0, 2));
    expect(p.g.black.moves).toEqual(OPENING.slice(0, 2));
    expect(p.g.red.turn).toBe("red");
  });

  it("goes back two plies when the opponent has already replied", () => {
    const p = pair({ base: 300, inc: 3 }, { rated: false });
    p.play(OPENING.slice(0, 4));
    p.g.black.requestTakeback(p.now); // Black moved last: one ply
    p.advance(100);
    expect(p.g.red.takeback?.plies).toBe(3);
    p.g.red.declineTakeback();
    p.advance(100);
    const q = pair({ base: 300, inc: 3 }, { rated: false });
    q.play(OPENING.slice(0, 4));
    q.g.red.requestTakeback(q.now); // Red's move and Black's reply
    q.advance(100);
    expect(q.g.black.takeback?.plies).toBe(2);
  });

  it("has no takebacks in rated games", () => {
    const p = pair();
    p.play(OPENING.slice(0, 2));
    expect(p.g.red.canRequestTakeback(p.now)).toBe(false);
    p.g.red.receive({ t: "takeback", plies: 1 }, p.now);
    expect(p.g.red.takeback).toBeNull();
  });
});

describe("disconnects", () => {
  it("notices an opponent gone quiet, and their return", () => {
    const p = pair({ base: 300, inc: 3 });
    p.play(OPENING.slice(0, 2));
    p.linkUp = false;
    p.advance(6_000);
    expect(p.g.red.away).not.toBeNull();
    expect(p.reports.red.some((r) => r.kind === "away")).toBe(true);
    p.linkUp = true;
    p.g.black.ping(p.now);
    p.advance(100);
    expect(p.g.red.away).toBeNull();
    expect(p.reports.red.at(-1)).toEqual({ kind: "back" });
  });

  it("lets the waiting player claim once the window is over (5+3: 42 s), and the clock still decides first", () => {
    const p = pair({ base: 300, inc: 3 });
    p.play(OPENING.slice(0, 4));
    p.linkUp = false; // Red to move, so Red's clock keeps running for Red; Black waits for Red
    p.advance(5_200);
    const away = p.g.black.away!;
    expect(away.windowMs).toBe(42_000);
    expect(p.g.black.claimState(p.now)?.kind).toBe("wait");
    p.advance(42_000);
    expect(p.g.black.claimState(p.now)?.kind).toBe("final");
    p.g.black.claimWin(p.now);
    expect(p.g.black.result).toEqual({ winner: "black", reason: "abandoned" });
  });

  it("in longer games allows an early claim after 1 min, then gives a last 30 s", () => {
    const p = pair({ base: 900, inc: 10 }); // window: (900 + 400) / 10 = 130 s
    p.play(OPENING.slice(0, 3));
    p.linkUp = false; // Black to move and gone
    p.advance(5_200);
    expect(p.g.red.away!.windowMs).toBe(130_000);
    p.advance(55_000);
    expect(p.g.red.claimState(p.now)?.kind).toBe("early");
    p.g.red.claimWin(p.now);
    expect(p.g.red.claimState(p.now)?.kind).toBe("last-chance");
    expect(p.g.red.result).toBeNull();
    p.advance(30_100);
    expect(p.g.red.result).toEqual({ winner: "red", reason: "abandoned" });
  });

  it("cuts the window to 10 s when the opponent closed the tab", () => {
    const p = pair({ base: 600, inc: 5 });
    p.play(OPENING.slice(0, 2));
    p.g.black.bye();
    p.linkUp = false;
    p.advance(100);
    expect(p.g.red.away?.windowMs).toBe(10_000);
    p.advance(10_000);
    p.g.red.claimDraw(p.now);
    expect(p.g.red.result).toEqual({ winner: null, reason: "claim-draw" });
  });

  it("brings a reloaded page up to date from the other browser", () => {
    const p = pair();
    p.play(OPENING);
    // Black's page reloads: a fresh game object, then hello / sync over a new link.
    const reports: Report[] = [];
    const sent: LinkMsg[] = [];
    const fresh = new OnlineGame({ me: "black", tc: { base: 300, inc: 3 }, rated: true, now: p.now }, { send: (m) => sent.push(m), report: (r) => reports.push(r), changed: () => {} });
    fresh.hello();
    const toRed: LinkMsg[] = [];
    const red = p.g.red as unknown as { io: { send: (m: LinkMsg) => void } };
    const orig = red.io.send;
    red.io.send = (m) => toRed.push(m);
    p.g.red.receive(sent[0]!, p.now);
    red.io.send = orig;
    expect(toRed[0]?.t).toBe("sync");
    fresh.receive(toRed[0]!, p.now + 50);
    expect(fresh.moves).toEqual(OPENING);
    expect(fresh.clocks).toEqual(p.g.red.clocks);
  });
});

describe("a browser that lies", () => {
  it("can't move twice or out of step", () => {
    const p = pair();
    p.play(OPENING.slice(0, 1));
    p.g.black.receive({ t: "move", ply: 3, iccs: "h0g2", clock: 300_000, seen: 300_000, hash: "x" }, p.now);
    expect(p.disputes.black[0]?.kind).toBe("out-of-step");
  });

  it("can't send an illegal move", () => {
    const p = pair();
    p.g.black.receive({ t: "move", ply: 1, iccs: "a0a9", clock: 300_000, seen: 300_000, hash: "x" }, 0);
    expect(p.disputes.black[0]).toEqual({ kind: "illegal-move", ply: 1, iccs: "a0a9" });
    expect(p.g.black.plies).toBe(0);
  });

  it("can't claim to have used less time than the opponent saw", () => {
    const p = pair({ base: 300, inc: 0 }, { delay: 10 });
    p.play(OPENING.slice(0, 2), 100);
    p.advance(20_000);
    // Red says it used nothing on a move that took 20 s.
    const msg = { t: "move" as const, ply: 3, iccs: "h0g2", clock: 300_000, seen: p.g.red.clocks.black, hash: "" };
    p.g.red.move("h0g2", p.now); // to get the hash
    msg.hash = p.g.red.hash;
    p.g.black.receive(msg, p.now);
    expect(p.g.black.clocks.red).toBeLessThanOrEqual(300_000 - 20_000 + 400);
  });

  it("can't take away more of my time than the allowance", () => {
    const p = pair();
    p.play(OPENING.slice(0, 3));
    const before = p.g.black.clocks.black;
    p.g.red.receive({ t: "move", ply: 4, iccs: OPENING[3]!, clock: 300_000, seen: 1000, hash: "" }, p.now);
    expect(p.g.red.clocks.red).toBeGreaterThan(1000);
    expect(before).toBeGreaterThan(1000);
  });

  it("rejects malformed messages", () => {
    expect(parseLinkMsg("{")).toBeNull();
    expect(parseLinkMsg({ t: "move", ply: "1" })).toBeNull();
    expect(parseLinkMsg({ t: "chat", phrase: "anything at all" })).toBeNull();
    expect(parseLinkMsg({ t: "chat", phrase: "gg" })).toEqual({ t: "chat", phrase: "gg" });
  });
});
