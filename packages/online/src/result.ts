// How an online game ends, and material counts for the rules that depend on it.
import { type Color, type EndReason, Game } from "xiangqi-core";

export type OnlineReason =
  | EndReason
  | "resign"
  | "timeout"
  | "agreement"
  /** The opponent left and the waiting player claimed the win (a draw without mating material). */
  | "abandoned"
  /** The waiting player claimed a draw after the opponent left. */
  | "claim-draw"
  /** Ended before both sides moved: no result. */
  | "aborted"
  /** Both players were gone longer than the window. */
  | "both-away"
  /** The server found an illegal move in the log: a loss for the browser that sent it. */
  | "illegal-move"
  /** The judge couldn't decide (the server's log has a gap and the browsers disagree). */
  | "no-result";

export interface OnlineResult {
  /** null: a draw, or no result for "aborted" and "no-result". */
  winner: Color | null;
  reason: OnlineReason;
  /**
   * The side at fault, for the sportsmanship record (M17): for "aborted", the side that aborted
   * or let its first-move timer run out; for "abandoned" and "claim-draw", the side that left.
   */
  by?: Color;
}

/** Endings that leave the game without a result, so unrated whatever was agreed. */
export const NO_RESULT: ReadonlySet<OnlineReason> = new Set(["aborted", "no-result", "both-away"]);

export const other = (c: Color): Color => (c === "red" ? "black" : "red");

const VALUE: Record<string, number> = { r: 9, n: 4, c: 4.5, a: 2, b: 2, p: 1, k: 0 };

/** Material on the board for each side (chariot 9, horse 4, cannon 4.5, advisor and elephant 2, soldier 1). */
export function material(g: Game): Record<Color, number> {
  const m = { red: 0, black: 0 };
  for (let s = 0; s < 90; s++) {
    const p = g.pieceAt(s);
    if (p) m[p.color] += VALUE[p.type]!;
  }
  return m;
}

/** Whether a side has any piece that can attack the enemy general (chariot, horse, cannon or soldier). */
export function canMate(g: Game, c: Color): boolean {
  for (let s = 0; s < 90; s++) {
    const p = g.pieceAt(s);
    if (p && p.color === c && "rncp".includes(p.type)) return true;
  }
  return false;
}

/** A win for `winner`, or a draw if they have nothing left to mate with (used for time-outs and abandonment). */
export const winOrDraw = (g: Game, winner: Color, reason: OnlineReason, by?: Color): OnlineResult => ({
  winner: canMate(g, winner) ? winner : null,
  reason,
  ...(by ? { by } : {}),
});

/** Plain words for a result, from the point of view of nobody in particular. */
export function resultText(r: OnlineResult): { en: string; zh: string } {
  const side = r.winner === "red" ? { en: "Red", zh: "红方" } : r.winner === "black" ? { en: "Black", zh: "黑方" } : null;
  const loser = r.winner === "red" ? { en: "Black", zh: "黑方" } : { en: "Red", zh: "红方" };
  switch (r.reason) {
    case "resign":
      return { en: `${loser.en} resigned`, zh: `${loser.zh}认输` };
    case "timeout":
      return side ? { en: `${loser.en} ran out of time`, zh: `${loser.zh}超时` } : { en: "Draw: time ran out, but the other side can't mate", zh: "和棋：超时，但对方无子可胜" };
    case "agreement":
      return { en: "Draw agreed", zh: "双方议和" };
    case "abandoned":
      return side ? { en: `${loser.en} left the game`, zh: `${loser.zh}离开了对局` } : { en: "Draw: the opponent left, with no mating material", zh: "和棋：对方离开，己方无子可胜" };
    case "claim-draw":
      return { en: "Draw claimed after the opponent left", zh: "对方离开后判和" };
    case "aborted":
      return { en: "Game aborted", zh: "对局取消" };
    case "both-away":
      return { en: "Draw: both players left", zh: "和棋：双方都已离开" };
    case "no-result":
      return { en: "No result", zh: "无结果" };
    case "illegal-move":
      return { en: `${loser.en} made an illegal move`, zh: `${loser.zh}走了违规着法` };
    default:
      return { en: side ? `${side.en} wins` : "Draw", zh: side ? `${side.zh}胜` : "和棋" };
  }
}
