import {
  ADVISOR,
  CANNON,
  CHARIOT,
  ELEPHANT,
  FILES,
  HORSE,
  KING,
  type Move,
  SOLDIER,
  SQUARES,
  type Side,
  codeOfType,
  fileOf,
  inPalace,
  makeMove,
  moveFrom,
  moveTo,
  onBoard,
  onOwnSide,
  rankOf,
  sq,
  typeChar,
} from "./board.js";

export const START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

const ORTHO: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAG: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
// Horse jumps as [df, dr, legDf, legDr]: one orthogonal step (the leg) then one diagonal step outward.
const HORSE_JUMPS: readonly (readonly [number, number, number, number])[] = [
  [1, 2, 0, 1],
  [-1, 2, 0, 1],
  [1, -2, 0, -1],
  [-1, -2, 0, -1],
  [2, 1, 1, 0],
  [2, -1, 1, 0],
  [-2, 1, -1, 0],
  [-2, -1, -1, 0],
];

// --- Zobrist hashing (two 32-bit halves; deterministic seed so hashes are stable) ---
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}
const rand = mulberry32(0x5eed1234);
const ZOBRIST_LO = new Uint32Array(14 * SQUARES).map(() => rand());
const ZOBRIST_HI = new Uint32Array(14 * SQUARES).map(() => rand());
const SIDE_LO = rand();
const SIDE_HI = rand();
const zIndex = (code: number, s: number) => (code > 0 ? code - 1 : 6 - code) * SQUARES + s;

/** What `make` needs to undo a move. */
export interface Undo {
  captured: number;
  halfmoveClock: number;
  hashLo: number;
  hashHi: number;
}

/**
 * A mutable Xiangqi position with fast make/unmake. Apps should normally use `Game`,
 * which wraps this with history, notation and game-end rulings.
 */
export class Position {
  readonly board = new Int8Array(SQUARES);
  turn: Side = 1;
  /** Plies since the last capture. */
  halfmoveClock = 0;
  fullmove = 1;
  hashLo = 0;
  hashHi = 0;
  /** King squares: index 0 = Red, 1 = Black. */
  readonly kings: [number, number] = [-1, -1];

  static fromFen(fen: string): Position {
    const p = new Position();
    const parts = fen.trim().split(/\s+/);
    const rows = (parts[0] ?? "").split("/");
    if (rows.length !== 10) throw new Error(`FEN needs 10 ranks: ${fen}`);
    rows.forEach((row, i) => {
      const rank = 9 - i;
      let file = 0;
      for (const ch of row) {
        if (/[1-9]/.test(ch)) {
          file += Number(ch);
          continue;
        }
        const lower = ch.toLowerCase();
        // Accept common alternative letters: h = horse, e = elephant.
        const t = lower === "h" ? "n" : lower === "e" ? "b" : lower;
        if (!"kabnrcp".includes(t) || file >= FILES) throw new Error(`bad FEN rank "${row}"`);
        const code = codeOfType(t as "k") * (ch === lower ? -1 : 1);
        p.put(sq(file, rank), code);
        file++;
      }
      if (file !== FILES) throw new Error(`FEN rank "${row}" must have 9 files`);
    });
    const side = parts[1] ?? "w";
    if (!["w", "r", "b"].includes(side)) throw new Error(`bad side to move: ${side}`);
    if (side === "b") {
      p.turn = -1;
      p.hashLo ^= SIDE_LO;
      p.hashHi ^= SIDE_HI;
    }
    p.halfmoveClock = Number(parts[4] ?? 0) || 0;
    p.fullmove = Number(parts[5] ?? 1) || 1;
    if (p.kings[0] < 0 || p.kings[1] < 0) throw new Error("FEN must have both generals");
    return p;
  }

  toFen(): string {
    const rows: string[] = [];
    for (let r = 9; r >= 0; r--) {
      let row = "";
      let empty = 0;
      for (let f = 0; f < FILES; f++) {
        const code = this.board[sq(f, r)]!;
        if (code === 0) {
          empty++;
          continue;
        }
        if (empty) row += String(empty);
        empty = 0;
        const c = typeChar(code);
        row += code > 0 ? c.toUpperCase() : c;
      }
      if (empty) row += String(empty);
      rows.push(row);
    }
    return `${rows.join("/")} ${this.turn === 1 ? "w" : "b"} - - ${this.halfmoveClock} ${this.fullmove}`;
  }

  clone(): Position {
    const p = new Position();
    p.board.set(this.board);
    p.turn = this.turn;
    p.halfmoveClock = this.halfmoveClock;
    p.fullmove = this.fullmove;
    p.hashLo = this.hashLo;
    p.hashHi = this.hashHi;
    p.kings[0] = this.kings[0];
    p.kings[1] = this.kings[1];
    return p;
  }

  /** 53-bit key for repetition tables (side to move is part of the hash). */
  get key(): number {
    return (this.hashHi & 0x1fffff) * 0x100000000 + this.hashLo;
  }

  private put(s: number, code: number) {
    this.board[s] = code;
    this.hashLo ^= ZOBRIST_LO[zIndex(code, s)]!;
    this.hashHi ^= ZOBRIST_HI[zIndex(code, s)]!;
    if (Math.abs(code) === KING) this.kings[code > 0 ? 0 : 1] = s;
  }

  private remove(s: number) {
    const code = this.board[s]!;
    this.board[s] = 0;
    this.hashLo ^= ZOBRIST_LO[zIndex(code, s)]!;
    this.hashHi ^= ZOBRIST_HI[zIndex(code, s)]!;
  }

  // --- Move generation ------------------------------------------------------

  /**
   * Pseudo-legal moves of the piece on square `s` (follows movement rules but may
   * leave the own general in check or facing the other general).
   */
  pieceMoves(s: number, out: Move[] = []): Move[] {
    const code = this.board[s]!;
    if (code === 0) return out;
    const side: Side = code > 0 ? 1 : -1;
    const f = fileOf(s);
    const r = rankOf(s);
    const b = this.board;
    const target = (t: number) => {
      const c = b[t]!;
      if (c === 0 || (c > 0) !== (side > 0)) out.push(makeMove(s, t));
    };
    switch (Math.abs(code)) {
      case KING:
        for (const [df, dr] of ORTHO) {
          if (!onBoard(f + df, r + dr)) continue;
          const t = sq(f + df, r + dr);
          if (inPalace(t, side)) target(t);
        }
        break;
      case ADVISOR:
        for (const [df, dr] of DIAG) {
          if (!onBoard(f + df, r + dr)) continue;
          const t = sq(f + df, r + dr);
          if (inPalace(t, side)) target(t);
        }
        break;
      case ELEPHANT:
        for (const [df, dr] of DIAG) {
          if (!onBoard(f + 2 * df, r + 2 * dr)) continue;
          const t = sq(f + 2 * df, r + 2 * dr);
          if (!onOwnSide(t, side)) continue; // never crosses the river
          if (b[sq(f + df, r + dr)] !== 0) continue; // blocked elephant eye (塞象眼)
          target(t);
        }
        break;
      case HORSE:
        for (const [df, dr, lf, lr] of HORSE_JUMPS) {
          if (!onBoard(f + df, r + dr)) continue;
          if (b[sq(f + lf, r + lr)] !== 0) continue; // hobbled horse (蹩马腿)
          target(sq(f + df, r + dr));
        }
        break;
      case CHARIOT:
        for (const [df, dr] of ORTHO) {
          for (let ff = f + df, rr = r + dr; onBoard(ff, rr); ff += df, rr += dr) {
            const t = sq(ff, rr);
            target(t);
            if (b[t] !== 0) break;
          }
        }
        break;
      case CANNON:
        for (const [df, dr] of ORTHO) {
          let screen = false;
          for (let ff = f + df, rr = r + dr; onBoard(ff, rr); ff += df, rr += dr) {
            const t = sq(ff, rr);
            const c = b[t]!;
            if (!screen) {
              if (c === 0) out.push(makeMove(s, t));
              else screen = true;
            } else if (c !== 0) {
              if ((c > 0) !== (side > 0)) out.push(makeMove(s, t)); // capture over exactly one screen
              break;
            }
          }
        }
        break;
      case SOLDIER: {
        if (onBoard(f, r + side)) target(sq(f, r + side));
        if (!onOwnSide(s, side)) {
          // Crossed the river: may also move sideways.
          if (f > 0) target(sq(f - 1, r));
          if (f < 8) target(sq(f + 1, r));
        }
        break;
      }
    }
    return out;
  }

  pseudoMoves(out: Move[] = []): Move[] {
    const b = this.board;
    const side = this.turn;
    for (let s = 0; s < SQUARES; s++) {
      const c = b[s]!;
      if (c !== 0 && (c > 0) === (side > 0)) this.pieceMoves(s, out);
    }
    return out;
  }

  /** All legal moves for the side to move. */
  legalMoves(): Move[] {
    const out: Move[] = [];
    for (const m of this.pseudoMoves()) if (this.isLegal(m)) out.push(m);
    return out;
  }

  /** True if the pseudo-legal move `m` does not leave the mover in check or facing the other general. */
  isLegal(m: Move): boolean {
    const side = this.turn;
    const u = this.make(m);
    const ok = !this.isInCheck(side) && !this.generalsFacing();
    this.unmake(m, u);
    return ok;
  }

  hasLegalMove(): boolean {
    for (const m of this.pseudoMoves()) if (this.isLegal(m)) return true;
    return false;
  }

  // --- Attacks ---------------------------------------------------------------

  /** Flying general: both generals on one file with nothing between them. */
  generalsFacing(): boolean {
    const [rk, bk] = this.kings;
    if (fileOf(rk) !== fileOf(bk)) return false;
    for (let s = rk + FILES; s < bk; s += FILES) if (this.board[s] !== 0) return false;
    return true;
  }

  isInCheck(side: Side): boolean {
    return this.isAttacked(this.kings[side === 1 ? 0 : 1], side === 1 ? -1 : 1);
  }

  /** True if any piece of side `by` could capture on square `s` (ignoring pins). */
  isAttacked(s: number, by: Side): boolean {
    const b = this.board;
    const f = fileOf(s);
    const r = rankOf(s);
    const own = (c: number, type: number) => c === type * by;

    // Chariot, cannon and general along files and ranks.
    for (const [df, dr] of ORTHO) {
      let seen = 0;
      for (let ff = f + df, rr = r + dr; onBoard(ff, rr); ff += df, rr += dr) {
        const c = b[sq(ff, rr)]!;
        if (c === 0) continue;
        seen++;
        if (seen === 1) {
          if (own(c, CHARIOT)) return true;
          if (own(c, KING) && Math.abs(ff - f) + Math.abs(rr - r) === 1 && inPalace(s, by)) return true;
        } else {
          if (own(c, CANNON)) return true;
          break;
        }
      }
    }
    // Horse: the horse at h attacks s if its leg (next to h, toward s) is empty.
    for (const [df, dr, lf, lr] of HORSE_JUMPS) {
      const hf = f - df;
      const hr = r - dr;
      if (!onBoard(hf, hr) || !own(b[sq(hf, hr)]!, HORSE)) continue;
      if (b[sq(hf + lf, hr + lr)] === 0) return true;
    }
    // Soldier: from behind (it moves forward into s) or, once across the river, from the side.
    if (onBoard(f, r - by) && own(b[sq(f, r - by)]!, SOLDIER)) return true;
    for (const df of [-1, 1]) {
      if (!onBoard(f + df, r)) continue;
      const t = sq(f + df, r);
      if (own(b[t]!, SOLDIER) && !onOwnSide(t, by)) return true;
    }
    // Advisor and elephant (only matter for squares on their own side).
    if (inPalace(s, by)) {
      for (const [df, dr] of DIAG) if (onBoard(f + df, r + dr) && own(b[sq(f + df, r + dr)]!, ADVISOR)) return true;
    }
    if (onOwnSide(s, by)) {
      for (const [df, dr] of DIAG) {
        if (!onBoard(f + 2 * df, r + 2 * dr)) continue;
        if (own(b[sq(f + 2 * df, r + 2 * dr)]!, ELEPHANT) && b[sq(f + df, r + dr)] === 0) return true;
      }
    }
    return false;
  }

  // --- Make / unmake ---------------------------------------------------------

  make(m: Move): Undo {
    const from = moveFrom(m);
    const to = moveTo(m);
    const piece = this.board[from]!;
    const captured = this.board[to]!;
    const u: Undo = { captured, halfmoveClock: this.halfmoveClock, hashLo: this.hashLo, hashHi: this.hashHi };
    if (captured !== 0) this.remove(to);
    this.remove(from);
    this.put(to, piece);
    this.halfmoveClock = captured !== 0 ? 0 : this.halfmoveClock + 1;
    if (this.turn === -1) this.fullmove++;
    this.turn = this.turn === 1 ? -1 : 1;
    this.hashLo ^= SIDE_LO;
    this.hashHi ^= SIDE_HI;
    return u;
  }

  unmake(m: Move, u: Undo): void {
    const from = moveFrom(m);
    const to = moveTo(m);
    const piece = this.board[to]!;
    this.board[from] = piece;
    this.board[to] = u.captured;
    if (Math.abs(piece) === KING) this.kings[piece > 0 ? 0 : 1] = from;
    this.turn = this.turn === 1 ? -1 : 1;
    if (this.turn === -1) this.fullmove--;
    this.halfmoveClock = u.halfmoveClock;
    this.hashLo = u.hashLo;
    this.hashHi = u.hashHi;
  }

  /**
   * Problems that make this position impossible in a real game (empty array if fine).
   * Used for set-up positions and FEN imports.
   */
  validate(): string[] {
    const errors: string[] = [];
    const counts = new Map<number, number>();
    const max = [0, 1, 2, 2, 2, 2, 2, 5];
    for (let s = 0; s < SQUARES; s++) {
      const c = this.board[s]!;
      if (c === 0) continue;
      counts.set(c, (counts.get(c) ?? 0) + 1);
      const side: Side = c > 0 ? 1 : -1;
      const name = `${side === 1 ? "Red" : "Black"} ${typeChar(c)} on ${"abcdefghi"[fileOf(s)]}${rankOf(s)}`;
      const f = fileOf(s);
      const ownRank = side === 1 ? rankOf(s) : 9 - rankOf(s); // rank from the owner's side
      switch (Math.abs(c)) {
        case KING:
          if (!inPalace(s, side)) errors.push(`${name}: the general must stay in the palace`);
          break;
        case ADVISOR:
          if (!inPalace(s, side) || (f + ownRank) % 2 !== 1) errors.push(`${name}: not an advisor point`);
          break;
        case ELEPHANT: {
          // The seven elephant points: even file and rank on its own half, file + rank ≡ 2 (mod 4).
          const ok = ownRank <= 4 && ownRank % 2 === 0 && f % 2 === 0 && (f + ownRank) % 4 === 2;
          if (!ok) errors.push(`${name}: not an elephant point`);
          break;
        }
        case SOLDIER:
          if (ownRank < 3 || (ownRank <= 4 && f % 2 === 1)) errors.push(`${name}: a soldier cannot be there`);
          break;
      }
    }
    for (const [c, n] of counts) {
      if (n > max[Math.abs(c)]!) errors.push(`too many ${c > 0 ? "Red" : "Black"} ${typeChar(c)} (${n})`);
    }
    if (this.generalsFacing()) errors.push("the generals face each other on an open file");
    if (this.isInCheck(this.turn === 1 ? -1 : 1)) errors.push("the side not to move is in check");
    return errors;
  }

  /** Count leaf nodes of the legal move tree (for testing move generation). */
  perft(depth: number): number {
    if (depth === 0) return 1;
    let n = 0;
    for (const m of this.pseudoMoves()) {
      const side = this.turn;
      const u = this.make(m);
      if (!this.isInCheck(side) && !this.generalsFacing()) n += depth === 1 ? 1 : this.perft(depth - 1);
      this.unmake(m, u);
    }
    return n;
  }
}
