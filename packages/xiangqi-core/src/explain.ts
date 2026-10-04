// Plain-language reasons why a move is illegal, for teaching feedback.

import {
  ADVISOR,
  CANNON,
  CHARIOT,
  ELEPHANT,
  HORSE,
  KING,
  SOLDIER,
  type Side,
  fileOf,
  inPalace,
  makeMove,
  onOwnSide,
  rankOf,
  sq,
} from "./board.js";
import type { Position } from "./position.js";

export type IllegalCode =
  | "no-piece"
  | "not-your-turn"
  | "own-piece"
  | "self-check"
  | "still-in-check"
  | "flying-general"
  | "palace"
  | "general-step"
  | "advisor-step"
  | "elephant-river"
  | "elephant-eye"
  | "elephant-step"
  | "horse-leg"
  | "horse-step"
  | "path-blocked"
  | "straight-line"
  | "cannon-screen"
  | "cannon-one-screen"
  | "soldier-backward"
  | "soldier-sideways"
  | "soldier-step";

export interface IllegalReason {
  code: IllegalCode;
  en: string;
  zh: string;
}

const TEXT: Record<IllegalCode, [string, string]> = {
  "no-piece": ["There is no piece there.", "这里没有棋子。"],
  "not-your-turn": ["That is not your piece to move.", "现在不是这方走棋。"],
  "own-piece": ["You cannot capture your own piece.", "不能吃自己的棋子。"],
  "self-check": ["That move would leave your general in check.", "这步棋会让自己的将（帅）被将军。"],
  "still-in-check": ["Your general is in check: you must get out of check.", "你正被将军，必须应将。"],
  "flying-general": ["The two generals may not face each other on an open file.", "将帅不能在同一直线上直接对面。"],
  palace: ["This piece must stay inside the palace.", "这个棋子不能离开九宫。"],
  "general-step": ["The general moves one point along a line.", "将（帅）每次只能直走一步。"],
  "advisor-step": ["The advisor moves one point diagonally.", "士（仕）每次只能斜走一步。"],
  "elephant-river": ["The elephant cannot cross the river.", "象（相）不能过河。"],
  "elephant-eye": ["The elephant's eye is blocked.", "塞象眼：象（相）眼被堵住了。"],
  "elephant-step": ["The elephant moves exactly two points diagonally.", "象（相）走田字。"],
  "horse-leg": ["The horse's leg is blocked.", "蹩马腿：马腿被绊住了。"],
  "horse-step": ["The horse moves one point straight, then one diagonally.", "马走日字。"],
  "path-blocked": ["Another piece is in the way.", "路线上有棋子挡住了。"],
  "straight-line": ["This piece moves along straight lines.", "这个棋子只能走直线。"],
  "cannon-screen": ["To capture, the cannon must jump over exactly one piece.", "炮吃子必须隔一个棋子（炮架）。"],
  "cannon-one-screen": ["The cannon can jump over only one piece.", "炮只能隔一个棋子吃子。"],
  "soldier-backward": ["Soldiers never move backward.", "兵（卒）不能后退。"],
  "soldier-sideways": ["Soldiers move sideways only after crossing the river.", "兵（卒）过河后才能横走。"],
  "soldier-step": ["The soldier moves one point at a time.", "兵（卒）每次只能走一步。"],
};

const reason = (code: IllegalCode): IllegalReason => ({ code, en: TEXT[code][0], zh: TEXT[code][1] });

/** Pieces strictly between two points on one file or rank. */
function between(pos: Position, from: number, to: number): number {
  const df = Math.sign(fileOf(to) - fileOf(from));
  const dr = Math.sign(rankOf(to) - rankOf(from));
  let n = 0;
  for (let f = fileOf(from) + df, r = rankOf(from) + dr; sq(f, r) !== to; f += df, r += dr) {
    if (pos.board[sq(f, r)] !== 0) n++;
  }
  return n;
}

/** Why moving from `from` to `to` is illegal for the side to move, or null if it is legal. */
export function explainIllegal(pos: Position, from: number, to: number): IllegalReason | null {
  const code = pos.board[from]!;
  if (code === 0) return reason("no-piece");
  const side: Side = code > 0 ? 1 : -1;
  if (side !== pos.turn) return reason("not-your-turn");
  const target = pos.board[to]!;
  if (target !== 0 && target > 0 === side > 0) return reason("own-piece");

  const m = makeMove(from, to);
  if (pos.pieceMoves(from).includes(m)) {
    if (pos.isLegal(m)) return null;
    const wasInCheck = pos.isInCheck(side);
    const u = pos.make(m);
    const facing = pos.generalsFacing();
    pos.unmake(m, u);
    if (facing) return reason("flying-general");
    return reason(wasInCheck ? "still-in-check" : "self-check");
  }

  const df = fileOf(to) - fileOf(from);
  const dr = rankOf(to) - rankOf(from);
  const adf = Math.abs(df);
  const adr = Math.abs(dr);
  const straight = df === 0 || dr === 0;
  switch (Math.abs(code)) {
    case KING:
      return reason(inPalace(to, side) ? "general-step" : "palace");
    case ADVISOR:
      return reason(inPalace(to, side) ? "advisor-step" : "palace");
    case ELEPHANT:
      if (!onOwnSide(to, side)) return reason("elephant-river");
      if (adf === 2 && adr === 2 && pos.board[sq(fileOf(from) + df / 2, rankOf(from) + dr / 2)] !== 0)
        return reason("elephant-eye");
      return reason("elephant-step");
    case HORSE:
      if ((adf === 1 && adr === 2) || (adf === 2 && adr === 1)) return reason("horse-leg");
      return reason("horse-step");
    case CHARIOT:
      return reason(straight ? "path-blocked" : "straight-line");
    case CANNON: {
      if (!straight) return reason("straight-line");
      const n = between(pos, from, to);
      if (target === 0) return reason("path-blocked");
      return reason(n === 0 ? "cannon-screen" : "cannon-one-screen");
    }
    case SOLDIER:
      if (dr * side < 0) return reason("soldier-backward");
      if (dr === 0 && adf === 1 && onOwnSide(from, side)) return reason("soldier-sideways");
      return reason("soldier-step");
  }
  return null;
}
