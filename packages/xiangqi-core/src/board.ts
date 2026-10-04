// Board geometry and piece encoding.
//
// The board has 9 files (a–i, 0–8) and 10 ranks (0–9). Red starts on ranks 0–4,
// Black on ranks 5–9. A square is a number 0–89: rank * 9 + file. "Square" here
// means a point (intersection) on the Xiangqi board.

export const FILES = 9;
export const RANKS = 10;
export const SQUARES = 90;

export type Color = "red" | "black";
export type PieceType = "k" | "a" | "b" | "n" | "r" | "c" | "p";

/** Side as a sign: Red = 1 (moves toward higher ranks), Black = -1. */
export type Side = 1 | -1;

// Piece codes stored in the board array: positive = Red, negative = Black, 0 = empty.
export const KING = 1; // General (帅/将)
export const ADVISOR = 2; // Advisor (仕/士)
export const ELEPHANT = 3; // Elephant (相/象)
export const HORSE = 4; // Horse (马)
export const CHARIOT = 5; // Chariot (车)
export const CANNON = 6; // Cannon (炮)
export const SOLDIER = 7; // Soldier (兵/卒)

const TYPE_CHARS: readonly PieceType[] = ["k", "a", "b", "n", "r", "c", "p"];

export const sq = (file: number, rank: number): number => rank * FILES + file;
export const fileOf = (s: number): number => s % FILES;
export const rankOf = (s: number): number => (s - (s % FILES)) / FILES;
export const onBoard = (file: number, rank: number): boolean =>
  file >= 0 && file < FILES && rank >= 0 && rank < RANKS;

export const sideOf = (color: Color): Side => (color === "red" ? 1 : -1);
export const colorOf = (side: Side): Color => (side === 1 ? "red" : "black");

export const typeChar = (code: number): PieceType => {
  const t = TYPE_CHARS[Math.abs(code) - 1];
  if (!t) throw new Error(`not a piece code: ${code}`);
  return t;
};
export const codeOfType = (t: PieceType): number => TYPE_CHARS.indexOf(t) + 1;

/** Palace: files d–f, ranks 0–2 (Red) or 7–9 (Black). */
export const inPalace = (s: number, side: Side): boolean => {
  const f = fileOf(s);
  const r = rankOf(s);
  if (f < 3 || f > 5) return false;
  return side === 1 ? r <= 2 : r >= 7;
};

/** True if the square is on the given side's half of the river. */
export const onOwnSide = (s: number, side: Side): boolean =>
  side === 1 ? rankOf(s) <= 4 : rankOf(s) >= 5;

export const FILE_LETTERS = "abcdefghi";

/** ICCS square name, e.g. 0 → "a0", 89 → "i9". */
export const squareName = (s: number): string => `${FILE_LETTERS[fileOf(s)]}${rankOf(s)}`;

export const parseSquare = (name: string): number => {
  const m = /^([a-i])([0-9])$/i.exec(name);
  if (!m) throw new Error(`bad square: ${name}`);
  return sq(FILE_LETTERS.indexOf(m[1]!.toLowerCase()), Number(m[2]));
};

/** A move packed into one number: from | to << 7. */
export type Move = number;
export const makeMove = (from: number, to: number): Move => from | (to << 7);
export const moveFrom = (m: Move): number => m & 127;
export const moveTo = (m: Move): number => m >> 7;
