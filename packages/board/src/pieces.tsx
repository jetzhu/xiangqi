import type { Color, PieceType } from "xiangqi-core";
import type { Theme } from "./themes.js";

export type PieceSet = "traditional" | "icons";

const CHARS: Record<Color, Record<PieceType, string>> = {
  red: { k: "帅", a: "仕", b: "相", n: "马", r: "车", c: "炮", p: "兵" },
  black: { k: "将", a: "士", b: "象", n: "马", r: "车", c: "炮", p: "卒" },
};

export const PIECE_NAMES: Record<PieceType, string> = {
  k: "General",
  a: "Advisor",
  b: "Elephant",
  n: "Horse",
  r: "Chariot",
  c: "Cannon",
  p: "Soldier",
};

/**
 * Icon glyphs for learners who don't read Chinese. Each hints at how the piece moves:
 * crown (general), diagonal cross (advisor), diamond (elephant: two points diagonally),
 * bent arrow (horse), long cross (chariot), cross with a jump mark (cannon), arrow (soldier).
 */
function Icon({ type, color, up }: { type: PieceType; color: string; up: boolean }) {
  const s = { stroke: color, strokeWidth: 0.055, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "k":
      return <polygon points="-0.22,0.14 -0.22,-0.07 -0.11,0.03 0,-0.17 0.11,0.03 0.22,-0.07 0.22,0.14" fill={color} />;
    case "a":
      return <path d="M-0.16,-0.16L0.16,0.16M0.16,-0.16L-0.16,0.16" {...s} />;
    case "b":
      return (
        <g>
          <path d="M0,-0.2L0.2,0L0,0.2L-0.2,0Z" {...s} />
          <circle r={0.045} fill={color} />
        </g>
      );
    case "n":
      return <path d="M-0.1,0.2V-0.04L0.16,-0.18M0.05,-0.19L0.16,-0.18L0.12,-0.08" {...s} />;
    case "r":
      return <path d="M0,-0.22V0.22M-0.22,0H0.22" {...s} strokeWidth={0.07} />;
    case "c":
      return (
        <g>
          <path d="M0,-0.06V0.22M-0.2,0.08H0.2" {...s} />
          <circle cy={-0.16} r={0.06} {...s} />
        </g>
      );
    case "p":
      return <path d={up ? "M0,0.18V-0.16M-0.11,-0.05L0,-0.17L0.11,-0.05" : "M0,-0.18V0.16M-0.11,0.05L0,0.17L0.11,0.05"} {...s} />;
  }
}

export interface PieceProps {
  type: PieceType;
  color: Color;
  set: PieceSet;
  theme: Theme;
  /** True if this piece's forward direction points up the screen (for the soldier icon). */
  forwardUp: boolean;
}

/** A piece drawn around (0, 0) with radius about 0.45. */
export function PieceGlyph({ type, color, set, theme, forwardUp }: PieceProps) {
  const ink = color === "red" ? theme.red : theme.blackText;
  const face = color === "red" ? theme.pieceFace : theme.blackFace;
  const ring = color === "red" ? theme.red : theme.black === theme.blackFace ? theme.blackText : theme.black;
  return (
    <g>
      <circle r={0.45} fill={face} stroke={theme.pieceEdge} strokeWidth={0.04} />
      <circle r={0.37} fill="none" stroke={ring} strokeWidth={0.03} />
      {set === "traditional" ? (
        <text
          fontSize={0.5}
          textAnchor="middle"
          dominantBaseline="central"
          fill={ink}
          fontFamily="'KaiTi', 'STKaiti', 'Kaiti SC', 'Noto Serif SC', 'Songti SC', serif"
          fontWeight={700}
        >
          {CHARS[color][type]}
        </text>
      ) : (
        <Icon type={type} color={ink} up={forwardUp} />
      )}
    </g>
  );
}
