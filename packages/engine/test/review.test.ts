import { describe, expect, it } from "vitest";
import { type ReviewedMove, accuracy, gradeCounts, gradeMove, winChance } from "../src/review.js";

describe("move grading", () => {
  it("win chance is 50% when equal and saturates on mate", () => {
    expect(winChance({ cp: 0 })).toBe(0.5);
    expect(winChance({ mate: 3 })).toBe(1);
    expect(winChance({ mate: -2 })).toBe(0);
  });
  it("grades by the drop in the mover's win chance (chess.com's bands)", () => {
    expect(gradeMove({ cp: 20 }, { cp: 15 }, true, true).grade).toBe("best"); // the engine's move
    expect(gradeMove({ cp: 20 }, { cp: 15 }, true).grade).toBe("excellent"); // loss 0.005
    expect(gradeMove({ cp: 20 }, { cp: -10 }, true).grade).toBe("good"); // 0.028
    expect(gradeMove({ cp: 0 }, { cp: -80 }, true).grade).toBe("inaccuracy"); // 0.074
    expect(gradeMove({ cp: 0 }, { cp: -150 }, true).grade).toBe("mistake"); // 0.135
    expect(gradeMove({ cp: 0 }, { cp: -300 }, true).grade).toBe("blunder"); // 0.252
    expect(gradeMove({ cp: 0 }, { cp: -900 }, true).grade).toBe("blunder");
  });
  it("a mistake right after the opponent's is a miss", () => {
    expect(gradeMove({ cp: 0 }, { cp: -150 }, true, false, 0.15).grade).toBe("miss");
    expect(gradeMove({ cp: 0 }, { cp: -300 }, true, false, 0.3).grade).toBe("miss");
    // A small slip after their mistake stays a small slip; a blunder after a mere inaccuracy stays a blunder.
    expect(gradeMove({ cp: 0 }, { cp: -80 }, true, false, 0.3).grade).toBe("inaccuracy");
    expect(gradeMove({ cp: 0 }, { cp: -300 }, true, false, 0.06).grade).toBe("blunder");
  });
  it("works from Black's side", () => {
    // Black was fine (Red +0.2) and now Red is +9: a blunder by Black.
    expect(gradeMove({ cp: 20 }, { cp: 900 }, false).grade).toBe("blunder");
    expect(gradeMove({ cp: 20 }, { cp: -50 }, false).grade).toBe("excellent");
  });
  it("small slips matter less when already winning", () => {
    expect(gradeMove({ cp: 1200 }, { cp: 950 }, true).grade).toBe("excellent");
    expect(gradeMove({ mate: 2 }, { cp: 0 }, true).grade).toBe("blunder");
  });
  it("counts grades per side", () => {
    const c = gradeCounts(
      [
        { index: 0, move: "h2e2", moverIsRed: true, grade: "book", loss: 0, bestMove: null, after: { cp: 0 } },
        { index: 1, move: "h9g7", moverIsRed: false, grade: "best", loss: 0, bestMove: null, after: { cp: 0 } },
        { index: 2, move: "a3a4", moverIsRed: true, grade: "mistake", loss: 0.25, bestMove: null, after: { cp: 0 } },
      ],
      true,
    );
    expect(c.book).toBe(1);
    expect(c.mistake).toBe(1);
    expect(c.best).toBe(0);
  });
  it("scores accuracy per side from the losses", () => {
    const mv = (moverIsRed: boolean, loss: number): ReviewedMove => ({ index: 0, move: "h2e2", moverIsRed, grade: "good", loss, bestMove: null, after: { cp: 0 } });
    expect(accuracy([mv(true, 0), mv(true, 0)], true)).toBeCloseTo(100, 0);
    expect(accuracy([mv(true, 0.1)], true)).toBeCloseTo(63.6, 0);
    // A typical game: mostly accurate moves with a couple of slips lands between 50 and 95.
    const typical = [0, 0.01, 0.02, 0.005, 0.08, 0, 0.03, 0.15, 0.01, 0].map((l) => mv(true, l));
    const a = accuracy(typical, true)!;
    expect(a).toBeGreaterThan(50);
    expect(a).toBeLessThan(95);
    expect(accuracy(typical, false)).toBeNull();
  });
});
