export interface EvalBarProps {
  /** Advantage in [-1, 1]: positive favours Red (see scoreToBar in @xq/engine). */
  value: number;
  /** Text shown at the advantaged side's end, e.g. "+1.25" or "M3". */
  label?: string;
  /** Which side is at the bottom, matching the board. */
  orientation?: "red" | "black";
  /** Shown while no evaluation is available. */
  pending?: boolean;
}

/** Vertical evaluation bar: Red fills from Red's end. Animates smoothly between values. */
export function EvalBar({ value, label = "", orientation = "red", pending = false }: EvalBarProps) {
  const v = Math.max(-1, Math.min(1, value));
  const redShare = pending ? 50 : (v + 1) * 50; // percent of the bar that is Red
  const redAtBottom = orientation === "red";
  const labelAtRed = v >= 0;
  return (
    <div
      role="meter"
      aria-label="Evaluation"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={pending ? 0 : Number(v.toFixed(2))}
      aria-valuetext={pending ? "no evaluation" : label}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 120,
        borderRadius: 6,
        overflow: "hidden",
        background: "#2b2b2b",
        display: "flex",
        flexDirection: redAtBottom ? "column-reverse" : "column",
      }}
    >
      <div style={{ height: `${redShare}%`, background: "#c0262d", transition: "height 0.35s ease" }} />
      {label && !pending && (
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 11,
            fontWeight: 700,
            fontFamily: "system-ui, sans-serif",
            color: "#fff",
            [labelAtRed === redAtBottom ? "bottom" : "top"]: 4,
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
