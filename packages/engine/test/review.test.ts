import { describe, expect, it } from "vitest";
import { gradeCounts, gradeMove, winChance } from "../src/review.js";

describe("move grading", () => {
  it("win chance is 50% when equal and saturates on mate", () => {
    expect(winChance({ cp: 0 })).toBe(0.5);
    expect(winChance({ mate: 3 })).toBe(1);
    expect(winChance({ mate: -2 })).toBe(0);
  });
  it("grades by the drop in the mover's win chance", () => {
    expect(gradeMove({ cp: 20 }, { cp: 15 }, true, true).grade).toBe("best"); // the engine's move
    expect(gradeMove({ cp: 20 }, { cp: 15 }, true).grade).toBe("excellent");
    expect(gradeMove({ cp: 20 }, { cp: -10 }, true).grade).toBe("excellent");
    expect(gradeMove({ cp: 0 }, { cp: -80 }, true).grade).toBe("good");
    expect(gradeMove({ cp: 0 }, { cp: -150 }, true).grade).toBe("inaccuracy");
    expect(gradeMove({ cp: 0 }, { cp: -300 }, true).grade).toBe("mistake");
    expect(gradeMove({ cp: 0 }, { cp: -900 }, true).grade).toBe("blunder");
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
});
