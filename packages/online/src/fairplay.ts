// Fair-play analysis (M18, docs/v0.3-online-design.md "Who analyses the games, for free"): after
// a rated game both players' browsers analyse every position at a fixed depth with one thread,
// which gives the same numbers on every machine, and send them to the `game` function. The
// server accepts them when the two agree. This file is what both sides share: the format, the
// score encoding and the agreement test.

/** Fixed search depth and lines per position: the same everywhere, so two browsers can be compared. */
export const FAIRPLAY_DEPTH = 8;
export const FAIRPLAY_LINES = 3;

/** Mate scores are sent as ±(MATE − moves to mate), so every score is one integer. */
export const MATE = 100_000;

/** An engine score (the engine package's Score): centipawns, or moves to mate. */
export interface EngineScore {
  cp?: number | undefined;
  mate?: number | undefined;
}

export const encodeScore = (s: EngineScore): number =>
  s.mate !== undefined ? Math.sign(s.mate || 1) * (MATE - Math.abs(s.mate)) : Math.round(s.cp ?? 0);

export const isMate = (n: number) => Math.abs(n) > MATE / 2;

/** Red's chance of winning from an encoded Red-view score, as the engine package's winChance. */
export const winChance = (n: number) => (isMate(n) ? (n > 0 ? 1 : 0) : 1 / (1 + Math.exp(-n / 270)));

/**
 * One browser's analysis of a game: for each position (the start, then after each move), the
 * engine's move and the scores of its top lines from Red's view, best first.
 */
export interface AnalysisData {
  v: 1;
  depth: number;
  positions: { b: string | null; s: number[] }[];
}

const MOVE = /^[a-i][0-9][a-i][0-9]$/;

/** Validates an analysis sent for a game of `plies` moves (it comes from a browser, so trust nothing). */
export function parseAnalysis(x: unknown, plies: number): AnalysisData | null {
  if (!x || typeof x !== "object") return null;
  const a = x as Partial<AnalysisData>;
  if (a.v !== 1 || a.depth !== FAIRPLAY_DEPTH || !Array.isArray(a.positions) || a.positions.length !== plies + 1) return null;
  for (const p of a.positions) {
    if (!p || typeof p !== "object") return null;
    if (p.b !== null && !(typeof p.b === "string" && MOVE.test(p.b))) return null;
    if (!Array.isArray(p.s) || p.s.length < 1 || p.s.length > FAIRPLAY_LINES) return null;
    if (!p.s.every((n) => Number.isInteger(n) && Math.abs(n) <= MATE)) return null;
  }
  return { v: 1, depth: a.depth, positions: a.positions.map((p) => ({ b: p.b, s: [...p.s] })) };
}

/** Scores within this many centipawns count as the same. */
export const AGREE_CP = 30;
/** Share of positions that must agree (engine move and score). */
export const AGREE_SHARE = 0.95;

/**
 * Whether two analyses of the same game agree. With the same engine build they're identical;
 * the tolerance absorbs a browser on an older cached build.
 */
export function analysesAgree(a: AnalysisData, b: AnalysisData): boolean {
  if (a.positions.length !== b.positions.length) return false;
  let same = 0;
  a.positions.forEach((p, i) => {
    const q = b.positions[i]!;
    const x = p.s[0]!;
    const y = q.s[0]!;
    const close = isMate(x) || isMate(y) ? Math.sign(x) === Math.sign(y) && isMate(x) === isMate(y) : Math.abs(x - y) <= AGREE_CP;
    if (p.b === q.b && close) same++;
  });
  return same >= AGREE_SHARE * a.positions.length;
}
