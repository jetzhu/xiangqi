import { describe, expect, it } from "vitest";
import { Game, toIccs } from "xiangqi-core";
import { type AnalysisData, FAIRPLAY_DEPTH, MATE, analysesAgree, encodeScore, parseAnalysis } from "../src/fairplay.js";
import type { LogRow } from "../src/server/decide.js";
import { scoreGame } from "../src/server/fairplay.js";
import { type Backend, type FairplayRecord, type GameRecord, handle } from "../src/server/game.js";

describe("the analysis format", () => {
  it("encodes mates as large scores and validates what a browser sends", () => {
    expect(encodeScore({ cp: 34.6 })).toBe(35);
    expect(encodeScore({ mate: 3 })).toBe(MATE - 3);
    expect(encodeScore({ mate: -2 })).toBe(-(MATE - 2));
    const ok = { v: 1, depth: FAIRPLAY_DEPTH, positions: [{ b: "h2e2", s: [20, 10] }, { b: null, s: [-MATE + 1] }] };
    expect(parseAnalysis(ok, 1)).toEqual(ok);
    expect(parseAnalysis(ok, 2)).toBeNull();
    expect(parseAnalysis({ ...ok, depth: 20 }, 1)).toBeNull();
    expect(parseAnalysis({ ...ok, positions: [{ b: "x", s: [1] }, { b: null, s: [1] }] }, 1)).toBeNull();
    expect(parseAnalysis({ ...ok, positions: [{ b: "h2e2", s: [1, 2, 3, 4] }, { b: null, s: [1] }] }, 1)).toBeNull();
  });

  it("agrees on the same numbers, with a little tolerance, and not on different ones", () => {
    const a: AnalysisData = { v: 1, depth: FAIRPLAY_DEPTH, positions: Array.from({ length: 40 }, (_, i) => ({ b: "h2e2", s: [i * 3] })) };
    const near = { ...a, positions: a.positions.map((p) => ({ ...p, s: [p.s[0]! + 20] })) };
    const off = { ...a, positions: a.positions.map((p, i) => (i % 5 === 0 ? { ...p, b: "b2e2" } : p)) };
    expect(analysesAgree(a, a)).toBe(true);
    expect(analysesAgree(a, near)).toBe(true);
    expect(analysesAgree(a, off)).toBe(false);
  });
});

/** A game, an analysis in which Red always plays the engine's move and Black never does, and a log of move times. */
function scenario(redMs: (ply: number) => number, blackMs: (ply: number) => number, redBlur = false) {
  const g = new Game();
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const moves: string[] = [];
  const positions: AnalysisData["positions"] = [];
  while (moves.length < 80) {
    const legal = g.legalMoves().map(toIccs);
    if (g.result || legal.length < 2) break;
    const played = legal[Math.floor(rand() * legal.length)]!;
    const red = moves.length % 2 === 0;
    const other = legal.find((m) => m !== played)!;
    // Red's moves are the engine's choice in hard positions (one good line); Black's lose 60 cp.
    positions.push(red ? { b: played, s: [0, -400, -500] } : { b: other, s: [0, 0, 0] });
    g.move(played);
    moves.push(played);
  }
  positions.push({ b: null, s: [0] });
  // Black's moves lose a little: the position after each is 60 cp worse for Black.
  positions.forEach((p, i) => {
    if (i > 0 && i % 2 === 0) p.s = p.s.map((x) => x + 60);
  });
  const log: LogRow[] = [];
  const clocks = { red: 300_000, black: 300_000 };
  moves.forEach((iccs, i) => {
    const ply = i + 1;
    const by = ply % 2 === 1 ? "red" : "black";
    const spent = (by === "red" ? redMs : blackMs)(ply);
    if (ply > 2) clocks[by] -= spent - 3000;
    log.push({ by, kind: "move", ply, report: { kind: "move", ply, iccs, clocks: { ...clocks }, hash: "", ...(by === "red" && redBlur ? { blur: true } : {}) }, at: i * 1000 });
  });
  return { moves, analysis: { v: 1 as const, depth: FAIRPLAY_DEPTH, positions }, log };
}

describe("scoring a game", () => {
  const baselines = { red: { acc: { mean: 60, sd: 10 }, match: { mean: 0.3, sd: 0.12 } }, black: { acc: { mean: 60, sd: 10 }, match: { mean: 0.3, sd: 0.12 } } };

  it("puts engine-like play far above the baseline, and flags even times, no fast moves and lost focus", () => {
    const s = scenario(() => 3000, (ply) => (ply % 3 === 0 ? 300 : 2000 + ply * 97));
    const out = scoreGame({ ...s, tc: { base: 300, inc: 3 }, baselines });
    expect(out.red.acc).toBe(100);
    expect(out.red.match).toBe(1);
    expect(out.red.z!).toBeGreaterThan(4);
    expect(out.red.flags).toEqual(expect.arrayContaining(["even-times", "few-fast"]));
    expect(out.black.match).toBe(0);
    expect(out.black.z!).toBeLessThan(0);
    expect(out.black.flags).toEqual([]);
    const blurred = scoreGame({ ...scenario(() => 3000, () => 2000, true), tc: { base: 300, inc: 3 }, baselines });
    expect(blurred.red.flags).toContain("focus");
  });

  it("doesn't score short games, and widens the baseline in Lightning", () => {
    const s = scenario(() => 3000, () => 2000);
    const short = scoreGame({ ...s, moves: s.moves.slice(0, 20), analysis: { ...s.analysis, positions: s.analysis.positions.slice(0, 21) }, tc: { base: 300, inc: 3 }, baselines });
    expect(short.red.z).toBeNull();
    const blitz = scoreGame({ ...s, tc: { base: 300, inc: 3 }, baselines });
    const lightning = scoreGame({ ...s, tc: { base: 120, inc: 1 }, baselines });
    expect(lightning.red.z!).toBeLessThan(blitz.red.z!);
  });
});

describe("the game function, with analyses", () => {
  const ID = "11111111-2222-4333-8444-555555555555";
  function setup(over: Partial<GameRecord> = {}) {
    const s = scenario(() => 3000, () => 2000);
    const game: GameRecord = {
      id: ID, red: "u1", black: "u2", speed: "blitz", status: "over", result: "red", reason: "resign", tc: { base: 300, inc: 3 }, rated: true, startedAt: 0,
      redRatingBefore: 1500, redRatingAfter: 1510, blackRatingBefore: 1480, blackRatingAfter: 1470, moves: s.moves, endedAt: 1_000_000, ...over,
    };
    const stored: Partial<Record<"red" | "black", AnalysisData>> = {};
    const records: FairplayRecord[] = [];
    const ratings: number[] = [];
    const db = {
      user: async (a: string | null) => (a === "Bearer one" ? "u1" : a === "Bearer two" ? "u2" : "u3"),
      game: async () => game,
      log: async () => s.log,
      saveAnalysis: async (_g: string, by: "red" | "black", data: AnalysisData) => {
        stored[by] = data;
        return { ...stored };
      },
      baseline: async (_s: string, r: number) => {
        ratings.push(r);
        return { acc: { mean: 60, sd: 10 }, match: { mean: 0.3, sd: 0.12 } };
      },
      config: async () => ({}),
      saveFairplay: async (_g: string, r: FairplayRecord) => void records.push(r),
    } as unknown as Backend;
    return { s, db, records, ratings };
  }
  const post = (who: string, body: unknown) => new Request("https://x", { method: "POST", headers: { authorization: `Bearer ${who}` }, body: JSON.stringify(body) });

  it("waits for the second analysis, then scores both sides", async () => {
    const { s, db, records, ratings } = setup();
    const r1 = await handle(post("one", { game: ID, analysis: s.analysis }), db, 1_000_500);
    expect(await r1.json()).toEqual({ fairplay: "one" });
    const r2 = await handle(post("two", { game: ID, analysis: s.analysis }), db, 1_000_500);
    expect(await r2.json()).toEqual({ fairplay: "checked" });
    expect(records.at(-1)).toMatchObject({ status: "checked", red: { match: 1 }, black: { match: 0 } });
    expect(ratings).toEqual([1500, 1480]);
  });

  it("marks two analyses that disagree, and refuses bad or late ones", async () => {
    const { s, db, records } = setup();
    const other = { ...s.analysis, positions: s.analysis.positions.map((p) => ({ ...p, s: [p.s[0]! + 500] })) };
    await handle(post("one", { game: ID, analysis: s.analysis }), db, 1_000_500);
    await handle(post("two", { game: ID, analysis: other }), db, 1_000_500);
    expect(records.at(-1)).toEqual({ status: "disagree" });
    expect((await handle(post("three", { game: ID, analysis: s.analysis }), db, 1_000_500)).status).toBe(404);
    expect((await handle(post("one", { game: ID, analysis: { v: 1 } }), db, 1_000_500)).status).toBe(400);
    expect((await handle(post("one", { game: ID, analysis: s.analysis }), db, 1_000_000 + 8 * 86_400_000)).status).toBe(409);
    const casual = setup({ rated: false });
    expect((await handle(post("one", { game: ID, analysis: casual.s.analysis }), casual.db, 1_000_500)).status).toBe(409);
  });
});
