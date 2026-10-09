import { BOTS, loadPuzzles } from "@xq/content";
import { describe, expect, it } from "vitest";
import { type BotGameClaim, checkBotGame, checkPuzzleAttempt } from "../src/index.js";

// Both sides shuffle a horse out and back: the third time the position comes round it's a draw.
const SHUFFLE = ["b0c2", "b9c7", "c2b0", "c7b9", "b0c2", "b9c7", "c2b0", "c7b9"];
const OPENING = ["h2e2", "h9g7", "h0g2", "i9h9"];

const claim = (c: Partial<BotGameClaim>): BotGameClaim => ({
  botId: "laochen",
  playerColor: "red",
  moves: OPENING,
  result: "loss",
  reason: "resign",
  ...c,
});

describe("checkBotGame", () => {
  it("takes the bot's rating from the site's list", () => {
    expect(checkBotGame(claim({}), BOTS)).toEqual({ ok: true, value: { botRating: 800 } });
  });

  it("accepts a result the final position shows, and only that one", () => {
    expect(checkBotGame(claim({ moves: SHUFFLE, result: "draw", reason: "repetition" }), BOTS).ok).toBe(true);
    expect(checkBotGame(claim({ moves: SHUFFLE, result: "win", reason: "repetition" }), BOTS)).toMatchObject({ ok: false });
    expect(checkBotGame(claim({ moves: SHUFFLE, result: "loss", reason: "resign" }), BOTS)).toMatchObject({ ok: false });
  });

  it("refuses illegal moves, moves after the end, and unknown bots", () => {
    expect(checkBotGame(claim({ moves: ["h2e2", "h9g7", "e2e9", "a9a8"] }), BOTS)).toMatchObject({ ok: false, error: expect.stringMatching(/illegal move "e2e9" at ply 3/) });
    expect(checkBotGame(claim({ moves: [...SHUFFLE, "b0c2"], result: "draw", reason: "repetition" }), BOTS)).toMatchObject({ ok: false, error: expect.stringMatching(/after the game ended/) });
    expect(checkBotGame(claim({ botId: "magnus" }), BOTS)).toMatchObject({ ok: false });
  });

  it("refuses games too short to record", () => {
    expect(checkBotGame(claim({ moves: ["h2e2", "h9g7", "h0g2"] }), BOTS)).toMatchObject({ ok: false });
  });

  it("resigning or leaving is only ever a loss", () => {
    expect(checkBotGame(claim({ reason: "abandoned" }), BOTS).ok).toBe(true);
    expect(checkBotGame(claim({ result: "win", reason: "resign" }), BOTS)).toMatchObject({ ok: false });
  });

  it("on time, the side to move loses", () => {
    // After four plies red is to move.
    expect(checkBotGame(claim({ result: "loss", reason: "timeout" }), BOTS).ok).toBe(true);
    expect(checkBotGame(claim({ result: "win", reason: "timeout" }), BOTS)).toMatchObject({ ok: false });
    expect(checkBotGame(claim({ playerColor: "black", result: "win", reason: "timeout" }), BOTS).ok).toBe(true);
  });

  it("a game still going can't end by a rules reason", () => {
    expect(checkBotGame(claim({ result: "win", reason: "checkmate" }), BOTS)).toMatchObject({ ok: false, error: expect.stringMatching(/isn't over/) });
  });
});

describe("checkPuzzleAttempt", async () => {
  const puzzles = await loadPuzzles();
  const long = puzzles.find((p) => p.solution.length >= 3)!;
  const solverMoves = long.solution.filter((_, i) => i % 2 === 0);

  it("accepts a solve that plays the solution through", () => {
    expect(checkPuzzleAttempt(long, solverMoves, 1).ok).toBe(true);
    expect(checkPuzzleAttempt(long, solverMoves, 0.5).ok).toBe(true);
  });

  it("refuses a solve that stops early, goes wrong or plays on", () => {
    expect(checkPuzzleAttempt(long, solverMoves.slice(0, -1), 1)).toMatchObject({ ok: false });
    expect(checkPuzzleAttempt(long, [], 1)).toMatchObject({ ok: false });
    expect(checkPuzzleAttempt(long, [...solverMoves, "a0a1"], 1)).toMatchObject({ ok: false });
    const g = long.solution[0]!;
    const other = puzzles.find((p) => p.id !== long.id && p.solution[0] !== g)!.solution[0]!;
    expect(checkPuzzleAttempt(long, [other, ...solverMoves.slice(1)], 1)).toMatchObject({ ok: false });
  });

  it("a miss is always believed", () => {
    expect(checkPuzzleAttempt(long, [], 0).ok).toBe(true);
    expect(checkPuzzleAttempt(long, ["zz"], 0).ok).toBe(true);
  });
});
