// Move notation: ICCS coordinates, WXF and Chinese.
//
// Files are counted from each player's own right: for Red, file i is 1 and file a is 9;
// for Black, file a is 1 and file i is 9. A move is written as piece + file + operation
// + number, where the operation is forward (+ / 进), backward (- / 退) or sideways (. / 平).
// For pieces that move in straight lines (general, chariot, cannon, soldier) the number is
// the distance when moving along the file and the destination file when moving sideways.
// Advisors, elephants and horses always give the destination file.

import {
  ADVISOR,
  ELEPHANT,
  FILES,
  HORSE,
  KING,
  type Move,
  SOLDIER,
  type Side,
  fileOf,
  makeMove,
  moveFrom,
  moveTo,
  parseSquare,
  rankOf,
  sq,
  squareName,
} from "./board.js";
import type { Position } from "./position.js";

const WXF_LETTERS = ["", "K", "A", "E", "H", "R", "C", "P"];
const RED_NAMES = ["", "帅", "仕", "相", "马", "车", "炮", "兵"];
const BLACK_NAMES = ["", "将", "士", "象", "马", "车", "炮", "卒"];
const CN_NUMERALS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const FW_DIGITS = ["", "１", "２", "３", "４", "５", "６", "７", "８", "９"];

/** File number (1–9) from the moving side's own right. */
const fileNumber = (file: number, side: Side) => (side === 1 ? FILES - file : file + 1);

export const toIccs = (m: Move): string => squareName(moveFrom(m)) + squareName(moveTo(m));

/** Parse an ICCS move ("h2e2", "H2-E2"); returns the move only if it is legal. */
export function parseIccs(pos: Position, text: string): Move | null {
  const t = text.trim().toLowerCase().replace("-", "");
  if (!/^[a-i][0-9][a-i][0-9]$/.test(t)) return null;
  const m = makeMove(parseSquare(t.slice(0, 2)), parseSquare(t.slice(2)));
  return pos.legalMoves().includes(m) ? m : null;
}

interface Parts {
  type: number;
  side: Side;
  /** Position among same-type pieces on the from-file, front first; -1 if not needed. */
  tandemIndex: number;
  tandemCount: number;
  /** Another file also holds two or more of these soldiers (Chinese drops the piece name). */
  multiFile: boolean;
  fromFile: number;
  op: "+" | "-" | ".";
  num: number;
}

function describe(pos: Position, m: Move): Parts {
  const from = moveFrom(m);
  const to = moveTo(m);
  const code = pos.board[from]!;
  if (code === 0) throw new Error(`no piece on ${squareName(from)}`);
  const side: Side = code > 0 ? 1 : -1;
  const type = Math.abs(code);
  const f1 = fileOf(from);
  const f2 = fileOf(to);
  const dr = (rankOf(to) - rankOf(from)) * side; // positive = toward the opponent
  const op = dr > 0 ? "+" : dr < 0 ? "-" : ".";
  const diagonal = type === ADVISOR || type === ELEPHANT || type === HORSE;
  const num = diagonal || op === "." ? fileNumber(f2, side) : Math.abs(dr);

  // Tandem pieces: same type and colour on the same file. Advisors and elephants are
  // never marked (their moves are already unambiguous); there is only one general.
  let tandemIndex = -1;
  let tandemCount = 1;
  let multiFile = false;
  if (type !== ADVISOR && type !== ELEPHANT && type !== KING) {
    const onFile: number[] = [];
    for (let r = 0; r < 10; r++) if (pos.board[sq(f1, r)] === code) onFile.push(r);
    if (onFile.length > 1) {
      onFile.sort((a, b) => (b - a) * side); // front (most advanced) first
      tandemIndex = onFile.indexOf(rankOf(from));
      tandemCount = onFile.length;
      if (type === SOLDIER) {
        for (let f = 0; f < FILES; f++) {
          if (f === f1) continue;
          let n = 0;
          for (let r = 0; r < 10; r++) if (pos.board[sq(f, r)] === code) n++;
          if (n > 1) multiFile = true;
        }
      }
    }
  }
  return { type, side, tandemIndex, tandemCount, multiFile, fromFile: f1, op, num };
}

/** WXF notation, e.g. "C2.5", "H8+7", tandem pieces "R+.4" / "R-+1". */
export function toWxf(pos: Position, m: Move): string {
  const d = describe(pos, m);
  const letter = WXF_LETTERS[d.type]!;
  let where: string;
  if (d.tandemIndex < 0) where = String(fileNumber(d.fromFile, d.side));
  else if (d.tandemCount === 2) where = d.tandemIndex === 0 ? "+" : "-";
  // Three or more soldiers on one file: a, b, c … from the front (provisional convention).
  else where = "abcde"[d.tandemIndex]!;
  return `${letter}${where}${d.op}${d.num}`;
}

const CN_OPS = { "+": "进", "-": "退", ".": "平" } as const;
const TANDEM_LABELS: Record<number, string[]> = {
  2: ["前", "后"],
  3: ["前", "中", "后"],
  4: ["一", "二", "三", "四"],
  5: ["一", "二", "三", "四", "五"],
};

/** Chinese notation, e.g. "炮二平五" (Red, Chinese numerals) or "马８进７" (Black, full-width digits). */
export function toChinese(pos: Position, m: Move): string {
  const d = describe(pos, m);
  const digits = d.side === 1 ? CN_NUMERALS : FW_DIGITS;
  const name = (d.side === 1 ? RED_NAMES : BLACK_NAMES)[d.type]!;
  const fileNum = digits[fileNumber(d.fromFile, d.side)]!;
  let head: string;
  if (d.tandemIndex < 0) head = name + fileNum;
  else {
    const label = TANDEM_LABELS[d.tandemCount]![d.tandemIndex]!;
    // With tandem soldiers on more than one file, the file replaces the piece name.
    head = d.multiFile ? label + fileNum : label + name;
  }
  return head + CN_OPS[d.op] + digits[d.num]!;
}

// --- Parsing WXF / Chinese by matching against the legal moves --------------

const CHAR_MAP: Record<string, string> = {
  帅: "K", 帥: "K", 将: "K", 將: "K",
  仕: "A", 士: "A",
  相: "E", 象: "E",
  马: "H", 馬: "H", 傌: "H", 碼: "H",
  车: "R", 車: "R", 俥: "R",
  炮: "C", 砲: "C", 包: "C",
  兵: "P", 卒: "P",
  进: "+", 進: "+", 退: "-", 平: ".",
  前: "+", 后: "-", 後: "-", 中: "=",
};

/** Reduce WXF or Chinese text to one comparable form. */
export function normalizeNotation(text: string): string {
  let s = "";
  for (const ch of text.trim()) {
    const fw = "０１２３４５６７８９".indexOf(ch);
    const cn = "〇一二三四五六七八九".indexOf(ch);
    if (fw >= 0) s += String(fw);
    else if (cn >= 0) s += String(cn);
    else s += CHAR_MAP[ch] ?? ch.toUpperCase();
  }
  // WXF variants: "=" for sideways, N/B for horse/elephant.
  return s.replace(/^([KAEHRCPNB])([1-9+\-ABCDE])=/, "$1$2.").replace(/^N/, "H").replace(/^B/, "E");
}

/**
 * Parse a move in ICCS, WXF or Chinese notation for the side to move.
 * Returns the legal move it names, or null.
 */
export function parseMove(pos: Position, text: string): Move | null {
  const iccs = parseIccs(pos, text);
  if (iccs !== null) return iccs;
  const want = normalizeNotation(text);
  for (const m of pos.legalMoves()) {
    if (normalizeNotation(toWxf(pos, m)) === want || normalizeNotation(toChinese(pos, m)) === want) return m;
  }
  return null;
}
