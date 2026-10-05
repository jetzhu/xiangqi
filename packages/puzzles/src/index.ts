// Puzzles: format, judging, rating updates and selection.

import { Game, Position } from "xiangqi-core";

export interface Puzzle {
  id: string;
  /** Position with the solver to move. */
  fen: string;
  /** Solver and opponent moves alternating (ICCS), starting and ending with the solver. */
  solution: string[];
  /** Estimated difficulty on the puzzle-rating scale. */
  rating: number;
  themes: string[];
  source: string;
}

export interface Text {
  en: string;
  zh: string;
}

/** The goal line the coach shows for a puzzle. */
export function goalOf(p: Puzzle): Text {
  const mate = p.themes.find((t) => /^mateIn\d$/.test(t));
  if (mate) {
    const n = Number(mate.slice(-1));
    return n === 1 ? { en: "Checkmate in one move.", zh: "一步杀。" } : { en: `Checkmate in ${n} moves.`, zh: `${n}步杀。` };
  }
  return { en: "Find the winning move.", zh: "找出制胜的一步。" };
}

export type Verdict = "correct" | "complete" | "wrong" | "illegal";

/**
 * Judge the solver's move at solution index `i` (even) from position `fen`.
 * The last move of a mate puzzle accepts any move that mates.
 */
export function judge(p: Puzzle, i: number, fen: string, move: string): Verdict {
  const g = new Game(fen);
  if (!g.move(move)) return "illegal";
  const last = i === p.solution.length - 1;
  if (move === p.solution[i]) return last ? "complete" : "correct";
  if (last && g.result?.reason === "checkmate") return "complete";
  return "wrong";
}

// --- Rating (Glicko-1) -----------------------------------------------------------------------

export interface Rating {
  rating: number;
  /** Rating deviation: how unsure we are. */
  rd: number;
}

export const NEW_PLAYER: Rating = { rating: 800, rd: 200 };
const Q = Math.log(10) / 400;
const PUZZLE_RD = 80;
const g = (rd: number) => 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));

/**
 * Update the solver's rating after a puzzle. `score` is 1 for solved, 0 for failed
 * (0.5 is a draw-like result). `maxChange` caps one puzzle's effect, so a new learner's
 * rating doesn't swing wildly.
 */
export function updateRating(r: Rating, puzzleRating: number, score: 0 | 0.5 | 1, maxChange = 80): Rating {
  const gj = g(PUZZLE_RD);
  const e = 1 / (1 + Math.pow(10, (-gj * (r.rating - puzzleRating)) / 400));
  const d2 = 1 / (Q * Q * gj * gj * e * (1 - e));
  const denom = 1 / (r.rd * r.rd) + 1 / d2;
  const change = Math.max(-maxChange, Math.min(maxChange, (Q / denom) * gj * (score - e)));
  const rating = r.rating + change;
  const rd = Math.max(50, Math.sqrt(1 / denom));
  return { rating: Math.round(rating), rd: Math.round(rd) };
}

// --- Selection -----------------------------------------------------------------------------

/**
 * Pick the next puzzle near the solver's rating, preferring unseen ones. The window widens
 * until something fits; returns null only if the list is empty.
 */
export function pickPuzzle(puzzles: readonly Puzzle[], rating: number, seen: ReadonlySet<string>, rng: () => number = Math.random): Puzzle | null {
  if (puzzles.length === 0) return null;
  const pool = puzzles.filter((p) => !seen.has(p.id));
  const from = pool.length ? pool : puzzles;
  for (let w = 100; w <= 3000; w *= 2) {
    const near = from.filter((p) => Math.abs(p.rating - rating) <= w);
    if (near.length) return near[Math.floor(rng() * near.length)]!;
  }
  return from[Math.floor(rng() * from.length)]!;
}

// --- Validation ----------------------------------------------------------------------------

export function validatePuzzle(p: Puzzle): string[] {
  const errs: string[] = [];
  let fen = p.fen;
  try {
    const v = Position.fromFen(fen).validate();
    if (v.length) return v.map((e) => `${p.id}: illegal position: ${e}`);
  } catch (e) {
    return [`${p.id}: ${(e as Error).message}`];
  }
  if (p.solution.length % 2 !== 1) errs.push(`${p.id}: solution must end with the solver's move`);
  const game = new Game(fen);
  for (const [i, m] of p.solution.entries()) {
    if (!game.move(m)) {
      errs.push(`${p.id}: move ${i + 1} (${m}) is illegal`);
      return errs;
    }
    if (game.result && i < p.solution.length - 1) errs.push(`${p.id}: game ends before the solution does`);
  }
  fen = game.fen;
  const mate = p.themes.some((t) => t.startsWith("mateIn"));
  if (mate && game.result?.reason !== "checkmate") errs.push(`${p.id}: tagged as mate but the line does not mate`);
  if (!(p.rating >= 400 && p.rating <= 3000)) errs.push(`${p.id}: rating out of range`);
  if (!p.id || !p.source) errs.push(`${p.id}: id or source missing`);
  return errs;
}
