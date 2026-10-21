// The evaluation graph of a reviewed game: one side's winning chances after each move, with the
// key moments (inaccuracies, mistakes, misses, blunders) as coloured dots. Used by the bot Game
// Review, the online Game Review and the analysis board.
import { type MoveGrade, type ReviewedMove, winChance } from "@xq/engine";
import type { Color } from "xiangqi-core";

export const KEY_GRADES: MoveGrade[] = ["inaccuracy", "mistake", "miss", "blunder"];
export const GRADE_COLOR: Partial<Record<MoveGrade, string>> = { inaccuracy: "#c99a1e", mistake: "#e58f2a", miss: "#d2683c", blunder: "#ca3431" };

/** The key moments of a reviewed game, for one side or both. */
export const keyMoments = (reviewed: readonly ReviewedMove[], side: Color | "both") =>
  reviewed.filter((m) => KEY_GRADES.includes(m.grade) && (side === "both" || m.moverIsRed === (side === "red")));

export function EvalGraph({
  reviewed,
  perspective,
  keys,
  focusIndex,
  onSelect,
  label,
}: {
  reviewed: readonly ReviewedMove[];
  /** Whose winning chances the curve shows (that side's at the top). */
  perspective: Color;
  /** The moves to mark with dots. */
  keys: readonly ReviewedMove[];
  /** A move to mark with a cursor line. */
  focusIndex: number | null;
  onSelect: (index: number) => void;
  label: string;
}) {
  const W = 300;
  const H = 72;
  const red = perspective === "red";
  const n = Math.max(1, reviewed.length);
  const x = (i: number) => ((i + 1) / n) * W;
  const y = (m: ReviewedMove) => {
    const w = winChance(m.after);
    return (1 - (red ? w : 1 - w)) * H;
  };
  const path = `M0 ${H / 2} ${reviewed.map((m, i) => `L${x(i).toFixed(1)} ${y(m).toFixed(1)}`).join(" ")}`;
  return (
    <svg className="eval-graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <rect width={W} height={H} className="eval-bg" />
      <path d={`${path} L${W} ${H} L0 ${H} Z`} className="eval-area" />
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="eval-mid" />
      {focusIndex !== null && <line x1={x(focusIndex)} x2={x(focusIndex)} y1="0" y2={H} className="eval-cursor" />}
      {keys.map((k) => (
        <circle key={k.index} cx={x(k.index)} cy={y(k)} r="3.5" fill={GRADE_COLOR[k.grade]} onClick={() => onSelect(k.index)} style={{ cursor: "pointer" }}>
          <title>{`${Math.floor(k.index / 2) + 1}${k.index % 2 ? "…" : "."} ${k.grade}`}</title>
        </circle>
      ))}
    </svg>
  );
}
