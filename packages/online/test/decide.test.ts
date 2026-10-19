import { describe, expect, it } from "vitest";
import { Game } from "xiangqi-core";
import { type LinkMsg, OnlineGame, type Report, type TimeControl } from "../src/index.js";
import { type LogRow, decide } from "../src/server/decide.js";
import { type Backend, type GameRecord, type RatingRow, Stale, handle } from "../src/server/game.js";

const OPENING = ["h2e2", "h9g7", "h0g2", "i9h9", "i0h0", "b9c7", "b0c2", "g6g5"];

/** Two browsers over a pretend link; every report lands in one log, stamped 20 ms after it was sent. */
function match(tc: TimeControl = { base: 300, inc: 3 }, rated = true) {
  let now = 1_000_000;
  const log: LogRow[] = [];
  const queue: { at: number; to: "red" | "black"; msg: LinkMsg }[] = [];
  let linkUp = true;
  let reporting = { red: true, black: true };
  const make = (me: "red" | "black") =>
    new OnlineGame(
      { me, tc, rated, now },
      {
        send: (msg) => linkUp && queue.push({ at: now + 30, to: me === "red" ? "black" : "red", msg }),
        report: (r: Report) => reporting[me] && log.push({ by: me, kind: r.kind, ply: r.kind === "move" ? r.ply : null, report: structuredClone(r), at: now + 20 }),
        changed: () => {},
      },
    );
  const g = { red: make("red"), black: make("black") };
  g.red.begin(now);
  g.black.begin(now);
  const startedAt = now;
  const advance = (ms: number) => {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + 50);
      queue.sort((a, b) => a.at - b.at);
      while (queue[0] && queue[0].at <= now) {
        const q = queue.shift()!;
        g[q.to].receive(q.msg, now);
      }
      g.red.tick(now);
      g.black.tick(now);
    }
  };
  return {
    g,
    log,
    advance,
    get now() {
      return now;
    },
    set linkUp(v: boolean) {
      linkUp = v;
    },
    set reporting(v: { red: boolean; black: boolean }) {
      reporting = v;
    },
    row: { tc, rated, startedAt },
    play(moves: string[]) {
      for (const m of moves) {
        advance(500);
        expect(g[g.red.turn].move(m, now)).toBe(true);
        advance(100);
      }
    },
  };
}

describe("deciding a result from the log", () => {
  it("accepts a result both browsers report", () => {
    const m = match();
    m.play(OPENING);
    m.g.black.resign(m.now);
    m.advance(200);
    const d = decide(m.row, m.log, m.now);
    expect(d).toMatchObject({ kind: "over", result: { winner: "red", reason: "resign" }, moves: OPENING, rated: true });
  });

  it("accepts a resignation from the resigner alone, but not a claim that the opponent resigned", () => {
    const m = match();
    m.play(OPENING);
    m.reporting = { red: false, black: true };
    m.g.black.resign(m.now);
    m.advance(200);
    expect(decide(m.row, m.log, m.now)).toMatchObject({ kind: "over", result: { winner: "red", reason: "resign" } });

    const n = match();
    n.play(OPENING);
    n.log.push({ by: "red", kind: "end", ply: null, report: { kind: "end", result: { winner: "red", reason: "resign" }, moves: OPENING, clocks: { red: 1, black: 1 } }, at: n.now });
    expect(decide(n.row, n.log, n.now).kind).toBe("pending");
  });

  it("accepts a time-out the server's timeline bears out, and not one it doesn't", () => {
    const m = match({ base: 60, inc: 0 });
    m.play(OPENING.slice(0, 3));
    m.reporting = { red: true, black: false }; // Black's browser has gone dark
    m.linkUp = false;
    m.advance(61_000);
    expect(m.g.red.result).toEqual({ winner: "red", reason: "timeout" });
    expect(decide(m.row, m.log, m.now)).toMatchObject({ kind: "over", result: { winner: "red", reason: "timeout" } });

    // Claimed 30 s early: not yet.
    const n = match({ base: 60, inc: 0 });
    n.play(OPENING.slice(0, 3));
    n.advance(30_000);
    n.log.push({ by: "red", kind: "end", ply: null, report: { kind: "end", result: { winner: "red", reason: "timeout" }, moves: OPENING.slice(0, 3), clocks: { red: 1, black: 0 } }, at: n.now });
    expect(decide(n.row, n.log, n.now)).toMatchObject({ kind: "pending" });
  });

  it("accepts an abandonment claim only after the opponent's silence", () => {
    const m = match({ base: 300, inc: 3 }); // window 42 s
    m.play(OPENING.slice(0, 4));
    m.reporting = { red: false, black: true };
    m.linkUp = false;
    m.advance(48_000);
    m.g.black.claimWin(m.now);
    m.advance(100);
    expect(m.g.black.result).toEqual({ winner: "black", reason: "abandoned", by: "red" });
    expect(decide(m.row, m.log, m.now)).toMatchObject({ kind: "over", result: { winner: "black", reason: "abandoned" }, rated: true, flagged: null });

    const n = match({ base: 300, inc: 3 });
    n.play(OPENING.slice(0, 4));
    n.advance(5_000);
    n.log.push({ by: "black", kind: "end", ply: null, report: { kind: "end", result: { winner: "black", reason: "abandoned" }, moves: OPENING.slice(0, 4), clocks: { red: 1, black: 1 } }, at: n.now });
    expect(decide(n.row, n.log, n.now)).toMatchObject({ kind: "pending" });
  });

  it("labels sportsmanship: abandoning, aborting, stalling and slow starts", () => {
    // Left and didn't come back.
    const a = match();
    a.play(OPENING.slice(0, 4));
    a.reporting = { red: false, black: true };
    a.linkUp = false;
    a.advance(48_000);
    a.g.black.claimWin(a.now);
    a.advance(100);
    expect(decide(a.row, a.log, a.now)).toMatchObject({ labels: { red: ["abandoned"] } });

    // Let the first-move timer run out: both browsers say Red.
    const b = match();
    b.advance(31_000);
    expect(decide(b.row, b.log, b.now)).toMatchObject({ result: { reason: "aborted", by: "red" }, labels: { red: ["aborted"] } });
    // Alone, a browser can't pin an abort on the other side.
    const c = match();
    c.log.push({ by: "black", kind: "end", ply: null, report: { kind: "end", result: { winner: null, reason: "aborted", by: "red" }, moves: [], clocks: { red: 1, black: 1 } }, at: c.now });
    expect(decide(c.row, c.log, c.now)).toMatchObject({ result: { reason: "aborted" }, labels: {} });

    // Down a soldier, Black lets 5 minutes run out rather than resign.
    const d = match();
    d.play(["h2e2", "h9g7", "e2e6"]);
    d.advance(301_000);
    expect(decide(d.row, d.log, d.now)).toMatchObject({ result: { winner: "red", reason: "timeout" }, labels: { black: ["stalled"] } });

    // Over half the base time on an early move.
    const e = match();
    e.play(OPENING.slice(0, 2));
    e.advance(160_000);
    e.play(OPENING.slice(2, 4));
    e.g.black.resign(e.now);
    e.advance(200);
    expect(decide(e.row, e.log, e.now)).toMatchObject({ result: { reason: "resign" }, labels: { red: ["slow-start"] } });
  });

  it("finds an illegal move in the log and gives the game to the other side", () => {
    const m = match();
    m.play(OPENING.slice(0, 2));
    m.log.push({ by: "red", kind: "move", ply: 3, report: { kind: "move", ply: 3, iccs: "a0a9", clocks: { red: 1, black: 1 }, hash: "" }, at: m.now });
    expect(decide(m.row, m.log, m.now)).toMatchObject({ kind: "over", result: { winner: "black", reason: "illegal-move" }, flagged: "red" });
  });

  it("doesn't rate an agreed rated draw before 10 moves each, or an abort after both moved", () => {
    const m = match();
    m.play(OPENING.slice(0, 4));
    const end = (by: "red" | "black", reason: "agreement" | "aborted") =>
      m.log.push({ by, kind: "end", ply: null, report: { kind: "end", result: { winner: null, reason }, moves: OPENING.slice(0, 4), clocks: { red: 1, black: 1 } }, at: m.now });
    end("red", "agreement");
    end("black", "agreement");
    expect(decide(m.row, m.log, m.now)).toMatchObject({ result: { reason: "no-result" }, rated: false });
  });

  it("ends a game the rules end, whatever the browsers say", () => {
    const m = match({ base: 3600, inc: 30 });
    // Seeded random play to a rules ending.
    const g = new Game();
    let seed = 3;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    while (!g.result) g.move(g.legalMoves()[Math.floor(rand() * g.legalMoves().length)]!);
    m.play(g.history.map((h) => h.iccs));
    expect(decide(m.row, m.log, m.now)).toMatchObject({ kind: "over", result: { winner: g.result!.winner, reason: g.result!.reason } });
  });
});

describe("the game server function", () => {
  function backend(game: GameRecord, log: LogRow[]) {
    const ratings: Record<string, RatingRow> = { u1: { rating: 1200, rd: 80, games: 30, last_played: null }, u2: { rating: 1150, rd: 90, games: 12, last_played: null } };
    const saved: unknown[] = [];
    let staleOnce = true;
    const db: Backend = {
      user: async (a) => (a === "Bearer one" ? "u1" : a === "Bearer two" ? "u2" : a === "Bearer three" ? "u3" : null),
      drain: async () => {},
      game: async () => game,
      log: async () => log,
      rating: async (u) => ratings[u] ?? null,
      saveAnalysis: async () => ({}),
      baseline: async () => ({ acc: { mean: 60, sd: 10 }, match: { mean: 0.3, sd: 0.12 } }),
      config: async () => ({}),
      isModerator: async () => false,
      saveFairplay: async () => {},
      finish: async (a) => {
        if (staleOnce) {
          staleOnce = false;
          throw new Stale();
        }
        if (game.status === "over") return false;
        saved.push(a);
        game.status = "over";
        return true;
      },
    };
    return { db, saved };
  }
  const req = (who: string, body: unknown) => new Request("https://x/functions/v1/game", { method: "POST", headers: { authorization: `Bearer ${who}` }, body: JSON.stringify(body) });
  const ID = "11111111-2222-4333-8444-555555555555";

  it("rates a finished game once, retrying when a rating changed meanwhile", async () => {
    const m = match();
    m.play(OPENING);
    m.g.red.resign(m.now);
    m.advance(200);
    const game: GameRecord = {
      id: ID, red: "u1", black: "u2", speed: "blitz", status: "playing", result: null, reason: null, tc: m.row.tc, rated: true, startedAt: m.row.startedAt,
      redRatingBefore: null, redRatingAfter: null, blackRatingBefore: null, blackRatingAfter: null,
    };
    const { db, saved } = backend(game, m.log);
    const res = await handle(req("two", { game: ID }), db, m.now);
    const out = (await res.json()) as { status: string; result: unknown; rated: boolean; ratings: { red: { before: number; after: number }; black: { before: number; after: number } } };
    expect(out).toMatchObject({ status: "over", result: { winner: "black", reason: "resign" }, rated: true });
    expect(out.ratings.red.after).toBeLessThan(1200);
    expect(out.ratings.black.after).toBeGreaterThan(1150);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ result: "black", reason: "resign", moves: OPENING, expected: { red: 30, black: 12 } });
  });

  it("answers only the game's players, and says when it can't settle the game yet", async () => {
    const m = match();
    m.play(OPENING.slice(0, 2));
    const game: GameRecord = {
      id: ID, red: "u1", black: "u2", speed: "blitz", status: "playing", result: null, reason: null, tc: m.row.tc, rated: true, startedAt: m.row.startedAt,
      redRatingBefore: null, redRatingAfter: null, blackRatingBefore: null, blackRatingAfter: null,
    };
    const { db } = backend(game, m.log);
    expect((await handle(req("three", { game: ID }), db)).status).toBe(404);
    expect((await handle(req("nobody", { game: ID }), db)).status).toBe(401);
    expect((await handle(req("one", { game: "x" }), db)).status).toBe(400);
    expect(await (await handle(req("one", { game: ID }), db, m.now)).json()).toMatchObject({ status: "playing", pending: "no end report yet" });
  });
});
