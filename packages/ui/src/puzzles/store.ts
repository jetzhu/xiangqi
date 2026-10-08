// Puzzle rating and history types; stored through the Store (store/index.tsx).
import type { Rating } from "@xq/puzzles";

export interface PuzzleRecord {
  id: string;
  /** 1 solved cleanly, 0.5 solved with a hint (unrated puzzles only), 0 failed. */
  score: 0 | 0.5 | 1;
  ratingAfter: number;
  at: string;
}
export interface PuzzleState {
  rating: Rating;
  history: PuzzleRecord[];
}
