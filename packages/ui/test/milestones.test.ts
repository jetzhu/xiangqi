import { describe, expect, it } from "vitest";
import { milestones, puzzleGain } from "../src/home/milestones.js";

const rec = (ratingAfter: number) => ({ id: "p", score: 1 as const, ratingAfter, at: "2026-10-09T00:00:00Z" });

describe("milestones", () => {
  it("are earned from saved progress", () => {
    const none = milestones({ mastered: 0, botsBeaten: 0, puzzles: [] });
    expect(none.map((m) => m.earned)).toEqual([false, false, false]);
    const all = milestones({ mastered: 1, botsBeaten: 2, puzzles: [rec(812), rec(870), rec(912), rec(890)] });
    expect(all.map((m) => m.earned)).toEqual([true, true, true]);
  });

  it("counts the puzzle gain from the first rating, at its highest", () => {
    expect(puzzleGain([])).toBe(0);
    expect(puzzleGain([rec(1210), rec(1150), rec(1290)])).toBe(80);
    expect(puzzleGain([rec(800), rec(905), rec(850)])).toBe(105);
  });
});
