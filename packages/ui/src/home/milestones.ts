// Milestones on the dashboard (as chess.com's achievements): earned ones in colour, the rest grey
// with what they take. Worked out from saved progress, so nothing extra is stored.
import type { Text } from "../settings.js";
import type { PuzzleRecord } from "../puzzles/store.js";

export interface Milestone {
  id: "first-lesson" | "first-bot" | "puzzle-100";
  title: Text;
  /** What it takes, shown while it isn't earned. */
  how: Text;
  earned: boolean;
}

/** How far above where they started a player's puzzle rating has been. */
export function puzzleGain(history: readonly PuzzleRecord[]): number {
  if (history.length === 0) return 0;
  const start = history[0]!.ratingAfter;
  return Math.max(...history.map((h) => h.ratingAfter)) - start;
}

export function milestones(p: { mastered: number; botsBeaten: number; puzzles: readonly PuzzleRecord[] }): Milestone[] {
  return [
    {
      id: "first-lesson",
      title: { en: "First lesson mastered", zh: "掌握第一课" },
      how: { en: "Master a lesson", zh: "掌握任意一课" },
      earned: p.mastered > 0,
    },
    {
      id: "first-bot",
      title: { en: "First bot beaten", zh: "首胜机器人" },
      how: { en: "Beat any bot", zh: "战胜任意一个机器人" },
      earned: p.botsBeaten > 0,
    },
    {
      id: "puzzle-100",
      title: { en: "Puzzle rating +100", zh: "解题等级分 +100" },
      how: { en: "Raise your puzzle rating by 100", zh: "将解题等级分提高 100" },
      earned: puzzleGain(p.puzzles) >= 100,
    },
  ];
}
