import { describe, expect, it } from "vitest";
import { START_FEN } from "xiangqi-core";
import { acceptedMoves, fewestStarMoves, judgeFindMove, learningRank, movesOf, playStarMove, startStars } from "../src/index.js";
import type { CaptureStarsStep, FindMoveStep } from "../src/index.js";

const T = { en: "x", zh: "x" };

describe("lesson steps", () => {
  it("lists one piece's legal moves", () => {
    expect(movesOf(START_FEN, "b0").sort()).toEqual(["b0a2", "b0c2"]);
  });

  it("collects stars and hands the move back to the learner", () => {
    const step: CaptureStarsStep = { type: "capture-stars", text: T, fen: "3k5/9/9/9/9/9/9/9/9/R3K4 w - - 0 1", square: "a0", stars: ["a5", "f5"], maxMoves: 4 };
    let s = startStars(step);
    s = playStarMove(s, "a0a5")!;
    expect(s.stars).toEqual(["f5"]);
    expect(s.fen.split(" ")[1]).toBe("w");
    expect(playStarMove(s, "e0e1")).toBeNull(); // only the lesson piece moves
    s = playStarMove(s, "a5f5")!;
    expect(s.stars).toEqual([]);
    expect(fewestStarMoves(step)).toBe(2);
  });

  it("finds impossible star layouts", () => {
    const step: CaptureStarsStep = { type: "capture-stars", text: T, fen: "3k5/9/9/9/9/9/9/9/9/2B1K4 w - - 0 1", square: "c0", stars: ["c5"], maxMoves: 6 };
    expect(fewestStarMoves(step, 6)).toBeNull(); // elephants never cross the river
  });

  it("judges find-move answers, including checkmate mode", () => {
    const listed: FindMoveStep = { type: "find-move", text: T, hint: T, success: T, fen: START_FEN, accept: ["h2e2", "b2e2"] };
    expect(judgeFindMove(listed, "h2e2")).toBe("correct");
    expect(judgeFindMove(listed, "h0g2")).toBe("wrong");
    expect(judgeFindMove(listed, "h2h8")).toBe("illegal");
    const mate: FindMoveStep = { ...listed, fen: "4k4/R8/6N2/9/9/9/9/9/5R3/3K5 w - - 0 1", accept: "checkmate" };
    expect(acceptedMoves(mate).sort()).toEqual(["a8a9", "a8e8", "f1e1", "f1f9"]);
  });

  it("ranks learners from Soldier to General", () => {
    expect(learningRank(0).rank.name.en).toBe("Soldier");
    expect(learningRank(4).rank.name.en).toBe("Elephant");
    expect(learningRank(11).rank.name.zh).toBe("帅");
    expect(learningRank(11).next).toBeNull();
  });
});
