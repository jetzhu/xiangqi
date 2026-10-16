// Move grading for feedback and post-game reviews.
//
// A move is graded by how much it lowers the mover's chance of winning compared with the
// engine's best move. Win chance comes from the evaluation via a logistic curve, so a
// 1-pawn slip in an equal position matters more than in an already-won one.

import type { XiangqiEngine } from "./engine.js";
import type { Score } from "./uci.js";

export type MoveGrade = "book" | "best" | "excellent" | "good" | "inaccuracy" | "mistake" | "miss" | "blunder";

/** Win chance in [0, 1] for Red from a Red-view score. */
export function winChance(s: Score): number {
  if (s.mate !== undefined) return s.mate > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-s.cp / 270));
}

/**
 * Grade boundaries on the drop in win chance (0–1), the same bands chess.com uses on its
 * "expected points". "best" is reserved for the engine's own top move; anything else that
 * loses almost nothing is "excellent".
 */
const BANDS: [MoveGrade, number][] = [
  ["excellent", 0.02],
  ["good", 0.05],
  ["inaccuracy", 0.1],
  ["mistake", 0.2],
];

/** A drop above this is a mistake; one right after the opponent's own mistake is a "miss". */
const MISTAKE = 0.1;

/**
 * Grade a move. `best` is the evaluation before the move (the best line), `after` the
 * evaluation after it, both from Red's view; `moverIsRed` says who moved. `opponentLoss`
 * is what the opponent's previous move cost them: a mistake or blunder right after one of
 * theirs is a "miss", a chance to punish it let go.
 */
export function gradeMove(
  best: Score,
  after: Score,
  moverIsRed: boolean,
  playedBest = false,
  opponentLoss = 0,
): { grade: MoveGrade; loss: number } {
  const before = moverIsRed ? winChance(best) : 1 - winChance(best);
  const now = moverIsRed ? winChance(after) : 1 - winChance(after);
  const loss = Math.max(0, before - now);
  if (playedBest) return { grade: "best", loss: 0 };
  if (loss > MISTAKE && opponentLoss >= MISTAKE) return { grade: "miss", loss };
  for (const [grade, limit] of BANDS) if (loss <= limit) return { grade, loss };
  return { grade: "blunder", loss };
}

export interface ReviewedMove {
  /** Index into the move list. */
  index: number;
  move: string;
  moverIsRed: boolean;
  grade: MoveGrade;
  loss: number;
  bestMove: string | null;
  /** Evaluation after the move (Red's view). */
  after: Score;
}

export interface ReviewOptions {
  depth?: number;
  /** Lines searched per position; the first is the engine's choice. */
  multipv?: number;
  /** Indexes of moves that are book moves (graded "book" without analysis). */
  isBook?: (index: number) => boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Review a whole game quickly: analyse every position once and grade each move by the
 * evaluation before and after it. `fens[i]` is the position before move i; `fens` has one
 * more entry than `moves` (the final position).
 */
export async function reviewGame(engine: XiangqiEngine, fens: string[], moves: string[], options: ReviewOptions = {}): Promise<ReviewedMove[]> {
  return reviewFromEvals(fens, moves, await analysePositions(engine, fens, options), options);
}

/** One position's analysis: the engine's move, and the scores of its top lines (Red's view, best first). */
export interface PositionEval {
  best: string | null;
  score: Score;
  /** The top lines' scores, best first (as many as `multipv` asked for, fewer if fewer legal moves). */
  scores: Score[];
}

/**
 * Analyse each position at a fixed depth. Every search starts from a cleared hash, so with one
 * thread the same engine build gives the same numbers on every machine (the fair-play check
 * compares two browsers' results).
 */
export async function analysePositions(engine: XiangqiEngine, fens: string[], options: ReviewOptions = {}): Promise<PositionEval[]> {
  const depth = options.depth ?? 8;
  const multipv = options.multipv ?? 1;
  const out: PositionEval[] = [];
  for (let i = 0; i < fens.length; i++) {
    const r = await engine.analyze(fens[i]!, { depth, multipv });
    const lines = [...r.lines].sort((a, b) => a.multipv - b.multipv);
    // No legal move: the side to move has lost.
    const redToMove = fens[i]!.split(/\s+/)[1] !== "b";
    const score: Score = lines[0] ? lines[0].score : { mate: redToMove ? -1 : 1 };
    out.push({ best: r.bestmove, score, scores: lines.length ? lines.map((l) => l.score) : [score] });
    options.onProgress?.(i + 1, fens.length);
  }
  return out;
}

/** Grades every move from the positions' analyses (`evals[i]` is the position before move i). */
export function reviewFromEvals(fens: string[], moves: string[], evals: readonly Pick<PositionEval, "best" | "score">[], options: Pick<ReviewOptions, "isBook"> = {}): ReviewedMove[] {
  const out: ReviewedMove[] = [];
  moves.forEach((move, i) => {
    const moverIsRed = fens[i]!.split(/\s+/)[1] !== "b";
    const before = evals[i]!;
    const after = evals[i + 1]!;
    if (options.isBook?.(i)) {
      out.push({ index: i, move, moverIsRed, grade: "book", loss: 0, bestMove: before.best, after: after.score });
      return;
    }
    const opponentLoss = out[i - 1]?.loss ?? 0;
    const { grade, loss } = gradeMove(before.score, after.score, moverIsRed, before.best === move, opponentLoss);
    out.push({ index: i, move, moverIsRed, grade, loss, bestMove: before.best, after: after.score });
  });
  return out;
}

/** Count grades for one side. */
export function gradeCounts(moves: ReviewedMove[], red: boolean): Record<MoveGrade, number> {
  const out: Record<MoveGrade, number> = { book: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0 };
  for (const m of moves) if (m.moverIsRed === red) out[m.grade]++;
  return out;
}

/**
 * Accuracy for one side, 0–100. Each move scores by its win-chance loss on the curve Lichess
 * publishes (no loss = 100, a 10-point drop ≈ 63, a 30-point drop ≈ 24), and the game is
 * the average. Book moves count as perfect. Typical games land between 50 and 95, the range
 * chess.com aims its own (unpublished) formula at. Null if the side made no moves.
 */
export function accuracy(moves: ReviewedMove[], red: boolean): number | null {
  const mine = moves.filter((m) => m.moverIsRed === red);
  if (mine.length === 0) return null;
  const perMove = (loss: number) => Math.min(100, Math.max(0, 103.1668 * Math.exp(-4.354 * loss) - 3.1669));
  return mine.reduce((sum, m) => sum + perMove(m.loss), 0) / mine.length;
}
