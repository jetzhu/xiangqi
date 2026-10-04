// UCI text parsing and coordinate conversion.
//
// ICCS (and Pikafish) number ranks 0–9: "h2e2". Fairy-Stockfish numbers them 1–10: "h3e3".

export type Coords = "iccs" | "fairy";

/** Score from Red's point of view. `mate` > 0 means Red mates in that many moves. */
export type Score = { cp: number; mate?: undefined } | { mate: number; cp?: undefined };

export interface InfoLine {
  depth: number;
  seldepth?: number;
  multipv: number;
  /** Score from the side to move's point of view, as the engine reports it. */
  score: Score;
  bound?: "lower" | "upper";
  nodes?: number;
  nps?: number;
  time?: number;
  /** Principal variation in the engine's own coordinates. */
  pv: string[];
}

/** Convert one move from the engine's coordinates to ICCS. */
export const toIccs = (move: string, coords: Coords): string =>
  coords === "iccs" ? move : move.replace(/([a-i])(10|[1-9])/g, (_, f: string, r: string) => f + (Number(r) - 1));

/** Convert one ICCS move to the engine's coordinates. */
export const fromIccs = (move: string, coords: Coords): string =>
  coords === "iccs" ? move : move.replace(/([a-i])([0-9])/g, (_, f: string, r: string) => f + (Number(r) + 1));

/** Parse an "info" line that carries a score and a PV; other lines give null. */
export function parseInfo(line: string): InfoLine | null {
  if (!line.startsWith("info ") || !line.includes(" pv ") || !line.includes(" score ")) return null;
  const tokens = line.split(/\s+/);
  const out: InfoLine = { depth: 0, multipv: 1, score: { cp: 0 }, pv: [] };
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    const next = () => Number(tokens[++i]);
    switch (t) {
      case "depth":
        out.depth = next();
        break;
      case "seldepth":
        out.seldepth = next();
        break;
      case "multipv":
        out.multipv = next();
        break;
      case "nodes":
        out.nodes = next();
        break;
      case "nps":
        out.nps = next();
        break;
      case "time":
        out.time = next();
        break;
      case "score": {
        const kind = tokens[++i];
        const v = next();
        out.score = kind === "mate" ? { mate: v } : { cp: v };
        if (tokens[i + 1] === "lowerbound" || tokens[i + 1] === "upperbound") {
          out.bound = tokens[++i] === "lowerbound" ? "lower" : "upper";
        }
        break;
      }
      case "pv":
        out.pv = tokens.slice(i + 1).filter(Boolean);
        i = tokens.length;
        break;
    }
  }
  return out;
}

/** Parse "bestmove x [ponder y]"; returns the move or null for "(none)". */
export function parseBestMove(line: string): string | null | undefined {
  if (!line.startsWith("bestmove")) return undefined;
  const m = line.split(/\s+/)[1];
  return !m || m === "(none)" || m === "0000" ? null : m;
}

/** Flip a side-to-move score to Red's point of view. */
export const toRedView = (s: Score, redToMove: boolean): Score =>
  redToMove ? s : s.mate !== undefined ? { mate: -s.mate } : { cp: -s.cp };

/** Score as a short label: "+1.25", "-0.30", "M3", "-M2" (Red's view, in pawns). */
export const formatScore = (s: Score): string =>
  s.mate !== undefined ? `${s.mate < 0 ? "-" : ""}M${Math.abs(s.mate)}` : `${s.cp >= 0 ? "+" : ""}${(s.cp / 100).toFixed(2)}`;

/**
 * Score as a number in [-1, 1] for an evaluation bar (Red's view): 0 is equal,
 * ±1 is a forced mate. Uses a logistic curve so ±4 pawns fills about 90%.
 */
export const scoreToBar = (s: Score): number =>
  s.mate !== undefined ? Math.sign(s.mate) || 1 : 2 / (1 + Math.exp(-s.cp / 270)) - 1;
