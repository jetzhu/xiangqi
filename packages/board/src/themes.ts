export type ThemeName = "wood" | "green" | "high-contrast" | "colorblind";

export interface Theme {
  board: string;
  line: string;
  riverText: string;
  coordinate: string;
  pieceFace: string;
  pieceEdge: string;
  red: string;
  black: string;
  /** Face colour for Black pieces (high contrast fills them dark). */
  blackFace: string;
  blackText: string;
  lastMove: string;
  selected: string;
  legal: string;
  hint: string;
  check: string;
  good: string;
  bad: string;
  cursor: string;
  lineWidth: number;
  /** Arrow colours, when the theme replaces the default green / red / blue / orange. */
  arrows?: { green: string; red: string; blue: string; orange: string };
}

const base = {
  lastMove: "rgba(255, 200, 40, 0.45)",
  selected: "rgba(60, 140, 255, 0.5)",
  legal: "rgba(20, 110, 60, 0.65)",
  hint: "rgba(40, 170, 90, 0.55)",
  check: "rgba(230, 30, 30, 0.75)",
  good: "rgba(40, 170, 90, 0.5)",
  bad: "rgba(220, 50, 50, 0.5)",
  cursor: "rgba(60, 140, 255, 0.9)",
};

export const THEMES: Record<ThemeName, Theme> = {
  wood: {
    ...base,
    board: "#e9c88f",
    line: "#5b3a1c",
    riverText: "#7a5330",
    coordinate: "#5b3a1c",
    pieceFace: "#f7e5b8",
    pieceEdge: "#8a5f2e",
    red: "#c0262d",
    black: "#1d1d1d",
    blackFace: "#f7e5b8",
    blackText: "#1d1d1d",
    lineWidth: 0.035,
  },
  green: {
    ...base,
    board: "#dfe6c3",
    line: "#4f6b32",
    riverText: "#5f7c40",
    coordinate: "#4f6b32",
    pieceFace: "#fbf6e6",
    pieceEdge: "#6e7f4a",
    red: "#c0262d",
    black: "#1d1d1d",
    blackFace: "#fbf6e6",
    blackText: "#1d1d1d",
    lineWidth: 0.035,
  },
  "high-contrast": {
    ...base,
    board: "#ffffff",
    line: "#000000",
    riverText: "#000000",
    coordinate: "#000000",
    pieceFace: "#ffffff",
    pieceEdge: "#000000",
    red: "#b00000",
    black: "#000000",
    blackFace: "#000000",
    blackText: "#ffffff",
    lastMove: "rgba(255, 170, 0, 0.6)",
    selected: "rgba(0, 90, 255, 0.6)",
    legal: "rgba(0, 120, 0, 0.9)",
    lineWidth: 0.05,
  },
  // Colour-blind safe: the sides differ by fill (light vs dark discs), not only by hue, and
  // highlights and arrows use the Okabe-Ito palette (blue / orange / vermillion / sky blue),
  // which stays distinct with red-green colour blindness.
  colorblind: {
    ...base,
    board: "#f1e2c2",
    line: "#4a3a28",
    riverText: "#4a3a28",
    coordinate: "#4a3a28",
    pieceFace: "#fff8ea",
    pieceEdge: "#4a3a28",
    red: "#c84f00",
    black: "#111111",
    blackFace: "#262626",
    blackText: "#ffffff",
    lastMove: "rgba(240, 228, 66, 0.55)",
    selected: "rgba(86, 180, 233, 0.6)",
    legal: "rgba(0, 114, 178, 0.8)",
    hint: "rgba(86, 180, 233, 0.6)",
    check: "rgba(213, 94, 0, 0.8)",
    good: "rgba(0, 114, 178, 0.5)",
    bad: "rgba(213, 94, 0, 0.55)",
    cursor: "rgba(0, 114, 178, 0.95)",
    lineWidth: 0.04,
    arrows: { green: "rgba(0, 114, 178, 0.85)", red: "rgba(213, 94, 0, 0.85)", blue: "rgba(86, 180, 233, 0.9)", orange: "rgba(230, 159, 0, 0.9)" },
  },
};
