import type { Puzzle } from "@xq/puzzles";
import { BOTS, LESSONS, UNITS } from "./generated.js";

export { BOTS, LESSONS, UNITS };

let puzzles: Promise<Puzzle[]> | null = null;
/**
 * The puzzle set, loaded on first use: it is the largest piece of content, so bundlers put it
 * in its own chunk and only puzzle pages fetch it.
 */
export const loadPuzzles = (): Promise<Puzzle[]> => (puzzles ??= import("./puzzles.generated.js").then((m) => m.PUZZLES));

/** Lessons in path order (unit by unit). */
export const LESSON_ORDER: string[] = UNITS.flatMap((u) => u.lessons);
export const lessonById = (id: string) => LESSONS.find((l) => l.id === id);
