// Puzzle rating and history types; stored through the Store (store/index.tsx).
import type { Rating } from "@xq/puzzles";

export interface PuzzleRecord {
  id: string;
  /** 1 solved cleanly, 0.5 solved with a hint (unrated puzzles only), 0 failed. */
  score: 0 | 0.5 | 1;
  ratingAfter: number;
  at: string;
  /** Names the attempt, so a signed-in player's is recorded once (M12). Missing on older ones. */
  clientId?: string;
  /** Whether it was meant to count for the rating (not a warm-up, a repeat or a hinted solve). */
  rated?: boolean;
  /** The solver's moves (ICCS), which the server checks. Missing on older attempts. */
  moves?: string[];
}
export interface PuzzleState {
  rating: Rating;
  history: PuzzleRecord[];
}
