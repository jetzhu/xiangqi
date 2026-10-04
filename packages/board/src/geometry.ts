// Board geometry in SVG user units: one unit between neighbouring points.
// Screen x runs 0–8 (files), y runs 0–9 (ranks, top to bottom).

import { fileOf, parseSquare, rankOf, sq, squareName } from "xiangqi-core";

export type Orientation = "red" | "black";

export interface Point {
  x: number;
  y: number;
}

/** Margin around the outer lines; larger when coordinates are drawn. */
export const margin = (coordinates: boolean) => (coordinates ? 0.95 : 0.6);

export const viewBox = (coordinates: boolean) => {
  const m = margin(coordinates);
  return `${-m} ${-m} ${8 + 2 * m} ${9 + 2 * m}`;
};

/** Centre of an ICCS square ("e2") on screen. */
export function toScreen(square: string, orientation: Orientation): Point {
  const s = parseSquare(square);
  const f = fileOf(s);
  const r = rankOf(s);
  return orientation === "red" ? { x: f, y: 9 - r } : { x: 8 - f, y: r };
}

/** Nearest square to a screen point, or null if outside the board. */
export function fromScreen(p: Point, orientation: Orientation): string | null {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  if (x < 0 || x > 8 || y < 0 || y > 9) return null;
  if (Math.abs(p.x - x) > 0.5 || Math.abs(p.y - y) > 0.5) return null;
  const f = orientation === "red" ? x : 8 - x;
  const r = orientation === "red" ? 9 - y : y;
  return squareName(sq(f, r));
}

/** Every square name, a0 … i9. */
export const ALL_SQUARES: readonly string[] = Array.from({ length: 90 }, (_, i) => squareName(i));
