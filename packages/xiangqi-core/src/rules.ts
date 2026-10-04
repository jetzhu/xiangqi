// Game-end rules: checkmate, stalemate, repetition rulings (perpetual check / chase) and
// the natural move limit. One rule set: standard Xiangqi as played under the World Xiangqi
// Federation rules. Rule summary used here (XBoard's Xiangqi rules page and WXF summaries):
//  - No legal move loses, whether in check (checkmate) or not (stalemate).
//  - On the third occurrence of a position the repeating loop is judged:
//    perpetual check loses; perpetual chase of the same unprotected piece loses;
//    if one side checks and the other chases, the checker loses; equal behaviour is a draw.
//  - A chase is a new attack on an unprotected piece. Attacks by a general or a soldier,
//    and attacks on a soldier still on its own half, are never chases. A chariot attacked by
//    a horse or cannon counts as unprotected. Being able to capture the attacker counts as
//    protection. Only legal moves count (pinned pieces neither attack nor protect).
//  - Draw after NATURAL_LIMIT_MOVES moves by each side without a capture.

import {
  CANNON,
  CHARIOT,
  type Color,
  HORSE,
  KING,
  type Move,
  SOLDIER,
  SQUARES,
  type Side,
  colorOf,
  makeMove,
  moveFrom,
  moveTo,
  onOwnSide,
} from "./board.js";
import type { Position } from "./position.js";

/** Moves by each side without a capture before the game is drawn. To confirm against the WXF rule text. */
export const NATURAL_LIMIT_MOVES = 50;

export type EndReason =
  | "checkmate"
  | "stalemate"
  | "perpetual-check"
  | "perpetual-chase"
  | "repetition"
  | "mutual-perpetual-check"
  | "mutual-perpetual-chase"
  | "natural-limit";

export interface GameResult {
  winner: Color | null;
  reason: EndReason;
  text: { en: string; zh: string };
}

/** How a move behaves for repetition rulings. */
export interface MoveNature {
  check: boolean;
  /** Ids of enemy pieces this move newly attacks while they are unprotected. */
  chased: number[];
}

/** Can the piece on `from` legally capture on `to`, with `side` to move? */
function canCapture(pos: Position, from: number, to: number, side: Side): boolean {
  const piece = pos.board[from]!;
  const target = pos.board[to]!;
  if (piece === 0 || target === 0 || piece > 0 !== side > 0 || target > 0 === side > 0) return false;
  const m = makeMove(from, to);
  if (!pos.pieceMoves(from).includes(m)) return false;
  const saved = pos.turn;
  pos.turn = side;
  const ok = pos.isLegal(m);
  pos.turn = saved;
  return ok;
}

/** Can `side` legally capture on square `s` with any piece? */
function anyCapture(pos: Position, s: number, side: Side): boolean {
  for (let f = 0; f < SQUARES; f++) if (canCapture(pos, f, s, side)) return true;
  return false;
}

/**
 * Classify move `m` for repetition rulings. `before` is the position before the move
 * (mover to play), `after` the position after it, `ids` the piece ids after the move.
 */
export function moveNature(before: Position, m: Move, after: Position, ids: Int32Array): MoveNature {
  const side = before.turn;
  const enemy: Side = side === 1 ? -1 : 1;
  const check = after.isInCheck(enemy);
  const chased: number[] = [];
  const from = moveFrom(m);
  const to = moveTo(m);

  for (let x = 0; x < SQUARES; x++) {
    const attacker = after.board[x]!;
    if (attacker === 0 || attacker > 0 !== side > 0) continue;
    const aType = Math.abs(attacker);
    if (aType === KING || aType === SOLDIER) continue;
    const xBefore = x === to ? from : x;
    for (let y = 0; y < SQUARES; y++) {
      const victim = after.board[y]!;
      if (victim === 0 || victim > 0 === side > 0) continue;
      const vType = Math.abs(victim);
      if (vType === KING) continue;
      if (vType === SOLDIER && onOwnSide(y, enemy)) continue;
      if (!canCapture(after, x, y, side)) continue;
      if (canCapture(before, xBefore, y, side)) continue; // not a new attack
      const chariotVsMinor = vType === CHARIOT && (aType === HORSE || aType === CANNON);
      if (!chariotVsMinor) {
        if (canCapture(after, y, x, enemy)) continue; // can take the attacker: protected
        const capture = makeMove(x, y);
        const saved = after.turn;
        after.turn = side;
        const u = after.make(capture);
        const recapture = anyCapture(after, y, enemy);
        after.unmake(capture, u);
        after.turn = saved;
        if (recapture) continue;
      }
      chased.push(ids[y]!);
    }
  }
  return { check, chased };
}

/** 0 = no violation, 1 = perpetual chase, 2 = perpetual check. */
function loopStatus(natures: MoveNature[]): 0 | 1 | 2 {
  if (natures.length === 0) return 0;
  if (natures.every((n) => n.check)) return 2;
  const chases = natures.filter((n) => !n.check);
  if (!chases.every((n) => n.chased.length > 0)) return 0;
  // The same piece must be chased on every chasing move.
  const common = chases.reduce<number[]>((acc, n) => acc.filter((id) => n.chased.includes(id)), chases[0]!.chased);
  return common.length > 0 ? 1 : 0;
}

const NAMES = { red: { en: "Red", zh: "红方" }, black: { en: "Black", zh: "黑方" } } as const;

/**
 * Judge a repetition loop: `loop` holds the natures of the moves since the previous
 * occurrence of the position, oldest first; `lastMover` made the final move of the loop.
 */
export function judgeRepetition(loop: MoveNature[], lastMover: Side): GameResult {
  const mine = loop.filter((_, i) => (loop.length - 1 - i) % 2 === 0);
  const theirs = loop.filter((_, i) => (loop.length - 1 - i) % 2 === 1);
  const a = loopStatus(mine);
  const b = loopStatus(theirs);
  const moverColor = colorOf(lastMover);
  const otherColor = colorOf(lastMover === 1 ? -1 : 1);
  if (a === b) {
    if (a === 2) return { winner: null, reason: "mutual-perpetual-check", text: { en: "Draw: both sides check perpetually", zh: "双方长将，和棋" } };
    if (a === 1) return { winner: null, reason: "mutual-perpetual-chase", text: { en: "Draw: both sides chase perpetually", zh: "双方长捉，和棋" } };
    return { winner: null, reason: "repetition", text: { en: "Draw by repetition", zh: "循环不变，和棋" } };
  }
  const loser = a > b ? moverColor : otherColor;
  const winner = loser === "red" ? "black" : "red";
  const check = Math.max(a, b) === 2;
  return {
    winner,
    reason: check ? "perpetual-check" : "perpetual-chase",
    text: check
      ? { en: `${NAMES[loser].en} loses: perpetual check`, zh: `${NAMES[loser].zh}长将判负` }
      : { en: `${NAMES[loser].en} loses: perpetual chase`, zh: `${NAMES[loser].zh}长捉判负` },
  };
}

/** Result when the side to move has no legal move. */
export function noMovesResult(pos: Position): GameResult {
  const loser = colorOf(pos.turn);
  const winner = loser === "red" ? "black" : "red";
  return pos.isInCheck(pos.turn)
    ? { winner, reason: "checkmate", text: { en: `${NAMES[winner].en} wins by checkmate`, zh: `${NAMES[winner].zh}胜：将死` } }
    : {
        winner,
        reason: "stalemate",
        text: { en: `${NAMES[winner].en} wins: ${NAMES[loser].en} has no legal move`, zh: `${NAMES[winner].zh}胜：${NAMES[loser].zh}困毙` },
      };
}

export const naturalLimitResult = (): GameResult => ({
  winner: null,
  reason: "natural-limit",
  text: {
    en: `Draw: ${NATURAL_LIMIT_MOVES} moves without a capture`,
    zh: `${NATURAL_LIMIT_MOVES}回合未吃子，和棋`,
  },
});
