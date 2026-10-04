import { describe, expect, it } from "vitest";
import { formatScore, fromIccs, parseBestMove, parseInfo, scoreToBar, toIccs, toRedView } from "../src/uci.js";

describe("UCI parsing", () => {
  it("parses an info line with MultiPV and a PV", () => {
    const i = parseInfo("info depth 12 seldepth 18 multipv 2 score cp -35 nodes 12345 nps 99000 time 124 pv h3e3 h10g8 b1c3");
    expect(i).toEqual({
      depth: 12, seldepth: 18, multipv: 2, score: { cp: -35 }, nodes: 12345, nps: 99000, time: 124,
      pv: ["h3e3", "h10g8", "b1c3"],
    });
  });
  it("parses mate scores and bounds", () => {
    expect(parseInfo("info depth 5 score mate -3 pv a1a2")!.score).toEqual({ mate: -3 });
    expect(parseInfo("info depth 9 score cp 20 lowerbound nodes 5 pv a1a2")!.bound).toBe("lower");
  });
  it("ignores lines without a score or PV", () => {
    expect(parseInfo("info string classical evaluation enabled")).toBeNull();
    expect(parseInfo("info depth 3 currmove h3e3 currmovenumber 1")).toBeNull();
  });
  it("parses bestmove", () => {
    expect(parseBestMove("bestmove h3e3 ponder h10g8")).toBe("h3e3");
    expect(parseBestMove("bestmove (none)")).toBeNull();
    expect(parseBestMove("info depth 1")).toBeUndefined();
  });
});

describe("coordinates and scores", () => {
  it("converts Fairy-Stockfish ranks 1–10 to ICCS 0–9 and back", () => {
    expect(toIccs("h10g8", "fairy")).toBe("h9g7");
    expect(toIccs("b1c3", "fairy")).toBe("b0c2");
    expect(fromIccs("h9g7", "fairy")).toBe("h10g8");
    expect(toIccs("h2e2", "iccs")).toBe("h2e2");
  });
  it("flips scores to Red's view when Black is to move", () => {
    expect(toRedView({ cp: 50 }, false)).toEqual({ cp: -50 });
    expect(toRedView({ mate: 2 }, false)).toEqual({ mate: -2 });
    expect(toRedView({ cp: 50 }, true)).toEqual({ cp: 50 });
  });
  it("formats scores and maps them to the eval bar", () => {
    expect(formatScore({ cp: 125 })).toBe("+1.25");
    expect(formatScore({ cp: -30 })).toBe("-0.30");
    expect(formatScore({ mate: -2 })).toBe("-M2");
    expect(scoreToBar({ cp: 0 })).toBe(0);
    expect(scoreToBar({ mate: 3 })).toBe(1);
    expect(scoreToBar({ cp: 400 })).toBeGreaterThan(0.6);
    expect(scoreToBar({ cp: 400 })).toBeLessThan(1);
  });
});
