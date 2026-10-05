import { type GameTree, Position, type TreeNode, parseIccs, toChinese, toWxf } from "xiangqi-core";

export type { NotationStyle } from "../settings.js";
import type { NotationStyle } from "../settings.js";

export const nodeLabel = (n: TreeNode, style: NotationStyle) =>
  style === "chinese" ? n.move!.chinese : style === "wxf" ? n.move!.wxf : n.move!.iccs;

/** Write an ICCS line (e.g. an engine PV) from `fen` in the chosen notation; stops at the first bad move. */
export function lineLabels(fen: string, pv: readonly string[], style: NotationStyle): string[] {
  const p = Position.fromFen(fen);
  const out: string[] = [];
  for (const iccs of pv) {
    const m = parseIccs(p, iccs);
    if (m === null) break;
    out.push(style === "chinese" ? toChinese(p, m) : style === "wxf" ? toWxf(p, m) : iccs);
    p.make(m);
  }
  return out;
}

/** Move number for a node, counting from the tree's starting move number. */
export function moveNumber(tree: GameTree, n: TreeNode): number {
  const start = Position.fromFen(tree.startFen);
  const blackFirst = start.turn === -1 ? 1 : 0;
  return start.fullmove + Math.floor((n.ply - 1 + blackFirst) / 2);
}
