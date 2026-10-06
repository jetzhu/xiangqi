import { describe, expect, it } from "vitest";
import { NEW_PLAYER, type Puzzle, dailyPuzzle, goalOf, judge, levelOf, pickInLevel, pickPuzzle, rushTarget, updateRating, validatePuzzle } from "../src/index.js";

const MATE: Puzzle = {
  id: "t-mate",
  fen: "4k4/R8/6N2/9/9/9/9/9/5R3/3K5 w - - 0 1",
  solution: ["a8a9"],
  rating: 600,
  themes: ["mateIn1", "oneMove", "chariot"],
  source: "test",
};

describe("puzzles", () => {
  it("accepts the listed move and any other mate on the last move", () => {
    expect(judge(MATE, 0, MATE.fen, "a8a9")).toBe("complete");
    expect(judge(MATE, 0, MATE.fen, "f1e1")).toBe("complete"); // another mate
    expect(judge(MATE, 0, MATE.fen, "a8a7")).toBe("wrong");
    expect(judge(MATE, 0, MATE.fen, "a8b9")).toBe("illegal");
  });

  it("states the goal", () => {
    expect(goalOf(MATE).zh).toBe("一步杀。");
    expect(goalOf({ ...MATE, themes: ["advantage"] }).en).toBe("Find the winning move.");
  });

  it("validates puzzles", () => {
    expect(validatePuzzle(MATE)).toEqual([]);
    expect(validatePuzzle({ ...MATE, solution: ["a8a7"] }).join()).toMatch(/does not mate/);
    expect(validatePuzzle({ ...MATE, solution: ["a8a9", "e9e8"] }).join()).toMatch(/end with the solver/);
    expect(validatePuzzle({ ...MATE, solution: ["a8b9"] }).join()).toMatch(/illegal/);
  });

  it("updates ratings sensibly", () => {
    const win = updateRating(NEW_PLAYER, 800, 1);
    const loss = updateRating(NEW_PLAYER, 800, 0);
    const half = updateRating(NEW_PLAYER, 800, 0.5);
    expect(win.rating).toBeGreaterThan(800);
    expect(loss.rating).toBeLessThan(800);
    expect(half.rating).toBe(800);
    expect(win.rd).toBeLessThan(NEW_PLAYER.rd);
    // One puzzle never moves the rating by more than the cap.
    expect(Math.abs(updateRating(NEW_PLAYER, 300, 0).rating - 800)).toBeLessThanOrEqual(80);
    // Solving a much harder puzzle gains more than an easy one.
    expect(updateRating(NEW_PLAYER, 1200, 1).rating - 800).toBeGreaterThan(updateRating(NEW_PLAYER, 500, 1).rating - 800);
  });

  it("picks unseen puzzles near the rating", () => {
    const ps = [500, 800, 820, 1500].map((r, i) => ({ ...MATE, id: `p${i}`, rating: r }));
    const seen = new Set(["p1"]);
    expect(pickPuzzle(ps, 810, seen, () => 0)!.id).toBe("p2");
    expect(pickPuzzle(ps, 2000, new Set(), () => 0)!.id).toBe("p3"); // widens the window
    expect(pickPuzzle([], 800, seen)).toBeNull();
  });
});

describe("daily puzzle and rush", () => {
  const mk = (id: string, rating: number): Puzzle => ({ id, fen: "", solution: [], rating, themes: [], source: "test" });
  const set = [mk("a", 500), mk("b", 700), mk("c", 900), mk("d", 1200), mk("e", 1500), mk("f", 2000)];
  it("gives everyone the same puzzle on the same day, from the middle of the range", () => {
    const p = dailyPuzzle(set, "2026-10-06")!;
    expect(dailyPuzzle([...set].reverse(), "2026-10-06")!.id).toBe(p.id);
    expect(p.rating).toBeGreaterThanOrEqual(600);
    expect(p.rating).toBeLessThanOrEqual(1600);
  });
  it("changes from day to day", () => {
    const ids = new Set(Array.from({ length: 14 }, (_, i) => dailyPuzzle(set, `2026-10-${String(i + 1).padStart(2, "0")}`)!.id));
    expect(ids.size).toBeGreaterThan(1);
  });
  it("rush targets climb", () => {
    expect(rushTarget(0)).toBe(400);
    expect(rushTarget(10)).toBeGreaterThan(rushTarget(5));
  });
});

describe("levels", () => {
  const mk = (id: string, rating: number): Puzzle => ({ id, fen: "", solution: [], rating, themes: [], source: "test" });
  const set = [mk("a", 600), mk("b", 900), mk("c", 1100), mk("d", 1300), mk("e", 1700)];
  it("maps ratings to levels", () => {
    expect(levelOf(600)).toBe("beginner");
    expect(levelOf(800)).toBe("standard");
    expect(levelOf(1599)).toBe("hard");
    expect(levelOf(2000)).toBe("extraHard");
  });
  it("picks inside the chosen level, nearest the solver's rating", () => {
    expect(pickInLevel(set, 600, "hard", new Set())!.id).toBe("d");
    expect(pickInLevel(set, 1150, "standard", new Set(), () => 0)!.id).toBe("c");
    expect(pickInLevel(set, 600, "extraHard", new Set(["e"]))!.id).toBe("e"); // all seen: repeats
    expect(pickInLevel([mk("x", 600)], 600, "hard", new Set())).toBeNull();
  });
});

describe("stalemate wins", () => {
  it("explains the goal: in Xiangqi a side with no legal move loses", () => {
    const p: Puzzle = { id: "s", fen: "", solution: ["a0a1", "a9a8", "a1a2"], rating: 1200, themes: ["stalemate"], source: "test" };
    expect(goalOf(p).en).toBe("Win in 2 moves: leave the opponent with no legal move.");
    expect(goalOf(p).zh).toContain("困毙");
  });
});
