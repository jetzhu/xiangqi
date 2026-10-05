import { BOTS, LESSONS, PUZZLES, UNITS } from "./generated.js";

export { BOTS, LESSONS, PUZZLES, UNITS };

/** Lessons in path order (unit by unit). */
export const LESSON_ORDER: string[] = UNITS.flatMap((u) => u.lessons);
export const lessonById = (id: string) => LESSONS.find((l) => l.id === id);
