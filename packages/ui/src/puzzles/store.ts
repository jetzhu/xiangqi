// Puzzle rating and history in IndexedDB (per browser).
import { NEW_PLAYER, type Rating } from "@xq/puzzles";
import { createStore, get, set } from "idb-keyval";

export interface PuzzleRecord {
  id: string;
  /** 1 solved cleanly, 0.5 solved with a hint (rating unchanged), 0 failed. */
  score: 0 | 0.5 | 1;
  ratingAfter: number;
  at: string;
}
export interface PuzzleState {
  rating: Rating;
  history: PuzzleRecord[];
}

const store = typeof indexedDB !== "undefined" ? createStore("xq-v1-puzzles", "puzzles") : undefined;
const EMPTY: PuzzleState = { rating: NEW_PLAYER, history: [] };

export async function loadPuzzleState(): Promise<PuzzleState> {
  if (!store) return EMPTY;
  try {
    return (await get<PuzzleState>("state", store)) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

export async function savePuzzleState(s: PuzzleState): Promise<void> {
  try {
    if (store) await set("state", s, store);
  } catch {
    // storage blocked: progress just isn't remembered
  }
}
