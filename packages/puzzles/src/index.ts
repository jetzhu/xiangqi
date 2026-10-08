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
  /** Where it came from: "pikafish-selfplay", "pikafish-selfplay-hard", "xiangqibench:<case id>". */
  source: string;
  /** Title of a classical composition, e.g. "第058局 中外二圣 - 适情雅趣". */
  name?: string;
  /** Offline grade (scripts/grade.mjs): difficulty score and level. */
  difficulty?: { D: number; level: "beginner" | "standard" | "hard" | "extraHard" };
}

export interface Text {
  en: string;
  zh: string;
}

/** The goal line the coach shows for a puzzle. */
export function goalOf(p: Puzzle): Text {
  // 困毙: in Xiangqi a side with no legal move loses, so stalemating the opponent wins.
  if (p.themes.includes("stalemate")) {
    const n = (p.solution.length + 1) / 2;
    return { en: `Win in ${n} moves: leave the opponent with no legal move.`, zh: `${n}步困毙：让对方无棋可走。` };
  }
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
  return updateVs(r, puzzleRating, PUZZLE_RD, score, maxChange);
}

/**
 * One Glicko-1 rating period against a single opponent of rating `opp` and deviation `oppRd`
 * (0 for an opponent of fixed, known strength, such as a bot). The change is capped at
 * `maxChange` either way.
 */
export function updateVs(r: Rating, opp: number, oppRd: number, score: 0 | 0.5 | 1, maxChange = 80): Rating {
  const gj = g(oppRd);
  const e = 1 / (1 + Math.pow(10, (-gj * (r.rating - opp)) / 400));
  const d2 = 1 / (Q * Q * gj * gj * e * (1 - e));
  const denom = 1 / (r.rd * r.rd) + 1 / d2;
  const change = Math.max(-maxChange, Math.min(maxChange, (Q / denom) * gj * (score - e)));
  const rating = r.rating + change;
  const rd = Math.max(50, Math.sqrt(1 / denom));
  return { rating: Math.round(rating), rd: Math.round(rd) };
}

/** RD of a new player; ratings at or above this are shown as provisional. */
export const PROVISIONAL_RD = 110;

/**
 * Uncertainty grows while a player is away (Glicko's c² term), so a returning player's rating
 * moves faster at first. c = 15 per day: about 200 days away takes a settled RD of 50 back to 200.
 */
export function ageRating(r: Rating, daysAway: number, c = 15): Rating {
  if (daysAway <= 0) return r;
  return { rating: r.rating, rd: Math.min(NEW_PLAYER.rd, Math.round(Math.sqrt(r.rd * r.rd + c * c * daysAway))) };
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

// --- Levels --------------------------------------------------------------------------------

/**
 * Puzzle levels as rating bands. Puzzles are graded offline (scripts/grade.mjs) into a
 * difficulty score D and seeded at 600 + 100·D, so the bands line up with the grading:
 * Beginner D < 2, Standard 2–5, Hard 5–8, Extra hard ≥ 8.
 */
export type Level = "beginner" | "standard" | "hard" | "extraHard";
export const LEVELS: Record<Level, { min: number; max: number }> = {
  beginner: { min: 0, max: 799 },
  standard: { min: 800, max: 1199 },
  hard: { min: 1200, max: 1599 },
  extraHard: { min: 1600, max: 9999 },
};
export const levelOf = (rating: number): Level =>
  rating < 800 ? "beginner" : rating < 1200 ? "standard" : rating < 1600 ? "hard" : "extraHard";

/**
 * Pick a puzzle from one level, as close to the solver's rating as the level allows, preferring
 * unseen ones. Null if the level has no puzzles.
 */
export function pickInLevel(puzzles: readonly Puzzle[], rating: number, level: Level, seen: ReadonlySet<string>, rng: () => number = Math.random): Puzzle | null {
  const band = LEVELS[level];
  const inBand = puzzles.filter((p) => p.rating >= band.min && p.rating <= band.max);
  if (inBand.length === 0) return null;
  const target = Math.min(band.max, Math.max(band.min, rating));
  return pickPuzzle(inBand, target, seen, rng);
}

/**
 * The daily puzzle for a calendar day (YYYY-MM-DD): the same for everyone, no server needed.
 * Drawn from the middle of the range (600–1600) so most players can solve it, with a hash
 * of the date so consecutive days don't step through the list in order.
 */
export function dailyPuzzle(puzzles: readonly Puzzle[], day: string): Puzzle | null {
  const pool = puzzles.filter((p) => p.rating >= 600 && p.rating <= 1600).sort((a, b) => (a.id < b.id ? -1 : 1));
  const from = pool.length ? pool : [...puzzles].sort((a, b) => (a.id < b.id ? -1 : 1));
  if (from.length === 0) return null;
  let h = 2166136261; // FNV-1a
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return from[(h >>> 0) % from.length]!;
}

/** Target rating for the n-th puzzle (from 0) of a Puzzle Rush: easy first, then harder. */
export const rushTarget = (n: number) => 400 + 60 * n;

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
  if (p.themes.includes("stalemate") && game.result?.reason !== "stalemate") errs.push(`${p.id}: tagged as stalemate but the line does not stalemate`);
  if (!(p.rating >= 400 && p.rating <= 3000)) errs.push(`${p.id}: rating out of range`);
  if (!p.id || !p.source) errs.push(`${p.id}: id or source missing`);
  return errs;
}
