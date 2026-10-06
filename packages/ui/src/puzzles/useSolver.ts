// Shared solving loop for the Daily and Rush modes: judge the solver's moves, play the
// opponent's replies from the solution, and report the end.
import { type Puzzle, judge } from "@xq/puzzles";
import { useMemo, useRef, useState } from "react";
import { Game, Position, squareName, toIccs } from "xiangqi-core";
import { useSound } from "../settings.js";

export interface Solver {
  fen: string;
  lastMove: string | null;
  solverRed: boolean;
  myTurn: boolean;
  legalMoves: string[];
  checkSquare: string | null;
  /** The solver's next move in the solution (for hints). */
  nextMove: string | undefined;
  position: Position | null;
  onMove: (move: string) => void;
  /** Back to the puzzle's start. */
  reset: () => void;
}

/** `onDone(true)` when solved, `onDone(false)` on the first wrong move. */
export function useSolver(puzzle: Puzzle | null, onDone: (solved: boolean) => void): Solver {
  const playSound = useSound();
  // State belongs to one puzzle: when the puzzle changes, its own start position shows on the
  // very first render (no frame with the old or an empty position).
  const [st, setSt] = useState<{ id: string | null; fen: string; ply: number; lastMove: string | null; busy: boolean }>({
    id: null,
    fen: "",
    ply: 0,
    lastMove: null,
    busy: false,
  });
  const fresh = !puzzle || st.id !== puzzle.id;
  const fen = fresh ? (puzzle?.fen ?? "") : st.fen;
  const ply = fresh ? 0 : st.ply;
  const lastMove = fresh ? null : st.lastMove;
  const busy = fresh ? false : st.busy;
  const current = useRef(puzzle);
  current.current = puzzle;

  const reset = () => setSt({ id: null, fen: "", ply: 0, lastMove: null, busy: false });

  const position = useMemo(() => (fen ? Position.fromFen(fen) : null), [fen]);
  const solverRed = puzzle ? puzzle.fen.split(" ")[1] !== "b" : true;
  const myTurn = !busy && position !== null && (position.turn === 1) === solverRed;
  const legalMoves = useMemo(() => (myTurn && fen ? new Game(fen).legalMoves().map(toIccs) : []), [fen, myTurn]);
  const checkSquare = position && position.isInCheck(position.turn) ? squareName(position.kings[position.turn === 1 ? 0 : 1]) : null;

  const onMove = (move: string) => {
    if (!puzzle || !myTurn) return;
    const verdict = judge(puzzle, ply, fen, move);
    const g = new Game(fen);
    const rec = g.move(move);
    if (!rec) return;
    playSound(rec.check ? "check" : rec.captured ? "capture" : "move");
    const id = puzzle.id;
    if (verdict === "complete") {
      setSt({ id, fen: g.fen, ply, lastMove: move, busy: true });
      onDone(true);
    } else if (verdict === "correct") {
      setSt({ id, fen: g.fen, ply, lastMove: move, busy: true });
      const reply = puzzle.solution[ply + 1]!;
      setTimeout(() => {
        if (current.current?.id !== id) return; // moved on to another puzzle
        const g2 = new Game(g.fen);
        const r2 = g2.move(reply)!;
        playSound(r2.check ? "check" : r2.captured ? "capture" : "move");
        setSt({ id, fen: g2.fen, ply: ply + 2, lastMove: reply, busy: false });
      }, 400);
    } else {
      setSt({ id, fen: g.fen, ply, lastMove: move, busy: true });
      playSound("illegal");
      onDone(false);
    }
  };

  return { fen, lastMove, solverRed, myTurn, legalMoves, checkSquare, nextMove: puzzle?.solution[ply], position, onMove, reset };
}
