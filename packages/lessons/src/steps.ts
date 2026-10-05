// Pure step logic shared by the lesson player and the validator.

import { Game, KING, Position, parseIccs, parseSquare, toIccs } from "xiangqi-core";
import type { CaptureStarsStep, FindMoveStep } from "./types.js";

/** Legal moves (ICCS) of the piece on `square`. */
export function movesOf(fen: string, square: string): string[] {
  const p = Position.fromFen(fen);
  const from = parseSquare(square);
  return p
    .legalMoves()
    .filter((m) => (m & 127) === from)
    .map(toIccs);
}

/** Give the move back to the learner: same pieces, learner's side to move. */
export function withSide(fen: string, side: "w" | "b"): string {
  const parts = fen.split(" ");
  parts[1] = side;
  return parts.join(" ");
}

export interface StarsState {
  fen: string;
  square: string;
  stars: string[];
  moves: number;
}

export const startStars = (step: CaptureStarsStep): StarsState => ({ fen: step.fen, square: step.square, stars: [...step.stars], moves: 0 });

/**
 * Play the learner's move in a capture-stars step. Only the lesson piece may move; the
 * opponent never replies (the side to move is handed back). Returns null if illegal.
 */
export function playStarMove(state: StarsState, move: string): StarsState | null {
  if (move.slice(0, 2) !== state.square) return null;
  const p = Position.fromFen(state.fen);
  const m = parseIccs(p, move);
  if (m === null) return null;
  // The opponent never moves in this challenge, so a general could otherwise be "captured".
  if (Math.abs(p.board[parseSquare(move.slice(2, 4))]!) === KING) return null;
  const side = state.fen.split(" ")[1] === "b" ? "b" : "w";
  p.make(m);
  const to = move.slice(2, 4);
  return { fen: withSide(p.toFen(), side), square: to, stars: state.stars.filter((s) => s !== to), moves: state.moves + 1 };
}

/** Fewest moves to collect every star (breadth-first search), or null if impossible within `limit`. */
export function fewestStarMoves(step: CaptureStarsStep, limit = 20): number | null {
  const key = (s: StarsState) => `${s.square}|${[...s.stars].sort().join(",")}`;
  let frontier = [startStars(step)];
  const seen = new Set(frontier.map(key));
  for (let depth = 0; depth <= limit; depth++) {
    const next: StarsState[] = [];
    for (const s of frontier) {
      if (s.stars.length === 0) return depth;
      for (const mv of movesOf(s.fen, s.square)) {
        const n = playStarMove(s, mv);
        if (n && !seen.has(key(n))) {
          seen.add(key(n));
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return null;
}

export type FindMoveResult = "correct" | "wrong" | "illegal";

/** Judge a find-move answer. */
export function judgeFindMove(step: FindMoveStep, move: string): FindMoveResult {
  const g = new Game(step.fen);
  const rec = g.move(move);
  if (!rec) return "illegal";
  if (step.accept === "checkmate") return g.result?.reason === "checkmate" ? "correct" : "wrong";
  return step.accept.includes(move) ? "correct" : "wrong";
}

/** All moves that would be accepted (for hints and validation). */
export function acceptedMoves(step: FindMoveStep): string[] {
  return new Game(step.fen)
    .legalMoves()
    .map(toIccs)
    .filter((m) => judgeFindMove(step, m) === "correct");
}
