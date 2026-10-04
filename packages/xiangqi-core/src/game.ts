import { type Color, type Move, type PieceType, SQUARES, colorOf, moveFrom, moveTo, typeChar } from "./board.js";
import { parseMove, toChinese, toIccs, toWxf } from "./notation.js";
import { Position, START_FEN, type Undo } from "./position.js";
import {
  type GameResult,
  type MoveNature,
  NATURAL_LIMIT_MOVES,
  judgeRepetition,
  moveNature,
  naturalLimitResult,
  noMovesResult,
} from "./rules.js";

export interface MoveRecord {
  move: Move;
  iccs: string;
  wxf: string;
  chinese: string;
  color: Color;
  piece: PieceType;
  captured: PieceType | null;
  check: boolean;
  fen: string;
}

interface Ply {
  record: MoveRecord;
  undo: Undo;
  nature: MoveNature;
  ids: Int32Array;
}

/**
 * A game of Xiangqi: legal moves, history with notation, undo and game-end rulings.
 * Moves can be given as a packed Move or as ICCS, WXF or Chinese text.
 */
export class Game {
  private pos: Position;
  private plies: Ply[] = [];
  private keys: number[];
  /** Stable piece ids that follow pieces as they move (for "same piece" chase rulings). */
  private ids = new Int32Array(SQUARES);
  private _result: GameResult | null = null;

  /** Throws if the FEN is malformed or describes an impossible position (see Position.validate). */
  constructor(fen: string = START_FEN) {
    this.pos = Position.fromFen(fen);
    const errors = this.pos.validate();
    if (errors.length) throw new Error(`illegal position: ${errors.join("; ")}`);
    this.keys = [this.pos.key];
    for (let s = 0; s < SQUARES; s++) this.ids[s] = this.pos.board[s] !== 0 ? s + 1 : 0;
    this.updateResult();
  }

  get fen(): string {
    return this.pos.toFen();
  }
  get turn(): Color {
    return colorOf(this.pos.turn);
  }
  get result(): GameResult | null {
    return this._result;
  }
  get history(): readonly MoveRecord[] {
    return this.plies.map((p) => p.record);
  }
  /** A copy of the current position (for engines or analysis). */
  position(): Position {
    return this.pos.clone();
  }

  /** Piece on a square (0–89), or null. */
  pieceAt(s: number): { color: Color; type: PieceType } | null {
    const c = this.pos.board[s]!;
    return c === 0 ? null : { color: c > 0 ? "red" : "black", type: typeChar(c) };
  }

  isCheck(): boolean {
    return this.pos.isInCheck(this.pos.turn);
  }

  legalMoves(): Move[] {
    return this._result ? [] : this.pos.legalMoves();
  }

  /** Legal destination squares for the piece on `from`. */
  destinations(from: number): number[] {
    return this.legalMoves()
      .filter((m) => moveFrom(m) === from)
      .map(moveTo);
  }

  /** Play a move. Returns its record, or null if it is illegal or the game is over. */
  move(input: Move | string): MoveRecord | null {
    if (this._result) return null;
    const m = typeof input === "string" ? parseMove(this.pos, input) : this.pos.legalMoves().includes(input) ? input : null;
    if (m === null) return null;

    const before = this.pos.clone();
    const piece = this.pos.board[moveFrom(m)]!;
    const capturedCode = this.pos.board[moveTo(m)]!;
    const wxf = toWxf(this.pos, m);
    const chinese = toChinese(this.pos, m);
    const undo = this.pos.make(m);
    const prevIds = this.ids.slice();
    this.ids[moveTo(m)] = this.ids[moveFrom(m)]!;
    this.ids[moveFrom(m)] = 0;
    const nature = moveNature(before, m, this.pos, this.ids);

    const record: MoveRecord = {
      move: m,
      iccs: toIccs(m),
      wxf,
      chinese,
      color: piece > 0 ? "red" : "black",
      piece: typeChar(piece),
      captured: capturedCode === 0 ? null : typeChar(capturedCode),
      check: nature.check,
      fen: this.pos.toFen(),
    };
    this.plies.push({ record, undo, nature, ids: prevIds });
    this.keys.push(this.pos.key);
    this.updateResult();
    return record;
  }

  /** Take back the last move. */
  undo(): MoveRecord | null {
    const ply = this.plies.pop();
    if (!ply) return null;
    this.pos.unmake(ply.record.move, ply.undo);
    this.ids.set(ply.ids);
    this.keys.pop();
    this._result = null;
    this.updateResult();
    return ply.record;
  }

  private updateResult() {
    this._result = null;
    if (!this.pos.hasLegalMove()) {
      this._result = noMovesResult(this.pos);
      return;
    }
    // Repetition: third occurrence of the current position (same side to move).
    const key = this.keys.at(-1)!;
    const seen: number[] = [];
    this.keys.forEach((k, i) => k === key && seen.push(i));
    if (seen.length >= 3) {
      const prev = seen.at(-2)!; // index into keys; plies[prev] is the first move of the loop
      const loop = this.plies.slice(prev).map((p) => p.nature);
      const lastMover = this.pos.turn === 1 ? -1 : 1;
      this._result = judgeRepetition(loop, lastMover);
      return;
    }
    if (this.pos.halfmoveClock >= 2 * NATURAL_LIMIT_MOVES) this._result = naturalLimitResult();
  }
}
