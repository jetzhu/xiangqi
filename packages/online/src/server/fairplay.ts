// Scoring a game for fair play (M18, docs/v0.3-online-design.md "What counts as suspicious"),
// once both browsers' analyses agree. Each side's middle-game moves are measured (accuracy,
// match with the engine's choice) and compared with honest players of the same rating and speed
// (the baseline), giving a z-score; timing and focus add flags. A player is judged later, from
// many games together (the database's update_fairplay_player), never from one.
//
// The thresholds come from the database (fairplay_config), not from this file: the code is
// public, and the site owner can change them there without publishing them.
import { type Color, Game } from "xiangqi-core";
import { type AnalysisData, winChance } from "../fairplay.js";
import type { Clocks, Report } from "../protocol.js";
import { type Speed, type TimeControl, speedOf } from "../timeControl.js";
import type { LogRow } from "./decide.js";

/** Honest players of one rating and speed: mean and spread of accuracy and of engine match. */
export interface Baseline {
  acc: { mean: number; sd: number };
  match: { mean: number; sd: number };
}

/** The tunable numbers, kept in the database (fairplay_config); missing keys use these. */
export const DEFAULT_CONFIG = {
  /** Plies scored: the middle game, about 16 to 120. */
  first_ply: 16,
  last_ply: 120,
  /** At least this many scored moves for a side's game to count. */
  min_moves: 10,
  /** Lightning is noisier: its baseline spread is widened by this. */
  lightning_sd_factor: 1.25,
  /** A move this close to the best in win chance counts as a good move (for difficulty). */
  good_move: 0.05,
  /** Timing and focus flags, each needing at least `min_timed` timed moves. */
  min_timed: 15,
  even_times_cv: 0.25,
  fast_ms: 500,
  few_fast_share: 0.02,
  focus_share: 0.8,
  flat_difficulty_ratio: 1.1,
  min_hard: 3,
};
export type FairplayConfig = typeof DEFAULT_CONFIG;

export type Flag = "even-times" | "few-fast" | "focus" | "flat-difficulty";

export interface SideScore {
  /** Moves scored (middle game, not forced). */
  moves: number;
  /** Mean move accuracy, 0–100, and share of moves matching the engine's choice. */
  acc: number | null;
  match: number | null;
  /** How far above honest players of the same rating, in standard deviations; null if too few moves. */
  z: number | null;
  flags: Flag[];
  /** The timing behind the flags, kept for the review page (M19). */
  timing: { cv: number | null; fast: number | null; focus: number | null; hard_ratio: number | null };
}

const perMoveAccuracy = (loss: number) => Math.min(100, Math.max(0, 103.1668 * Math.exp(-4.354 * loss) - 3.1669));
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: readonly number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/** Think time of each ply from the mover's own reports (clock before − clock after + increment), and its focus bit. */
export function moveTimes(log: readonly LogRow[], plies: number, tc: TimeControl): { ms: (number | null)[]; blur: boolean[] } {
  const own = new Map<number, { clocks: Clocks; blur: boolean }>();
  for (const row of log) {
    if (row.report.kind !== "move" || row.ply === null) continue;
    const mover: Color = row.ply % 2 === 1 ? "red" : "black";
    if (row.by !== mover) continue;
    const r = row.report as Extract<Report, { kind: "move" }>;
    own.set(row.ply, { clocks: r.clocks, blur: !!r.blur });
  }
  const ms: (number | null)[] = [];
  const blur: boolean[] = [];
  for (let ply = 1; ply <= plies; ply++) {
    const mover: Color = ply % 2 === 1 ? "red" : "black";
    const now = own.get(ply);
    const before = own.get(ply - 2);
    ms.push(now && before ? Math.max(0, before.clocks[mover] - now.clocks[mover] + tc.inc * 1000) : null);
    blur.push(now?.blur ?? false);
  }
  return { ms, blur };
}

/**
 * Scores both sides of a game from an agreed analysis. `baselines` are for each side's rating
 * at the start of the game.
 */
export function scoreGame(args: {
  moves: readonly string[];
  analysis: AnalysisData;
  log: readonly LogRow[];
  tc: TimeControl;
  baselines: Record<Color, Baseline>;
  config?: Partial<FairplayConfig>;
}): Record<Color, SideScore> {
  const c = { ...DEFAULT_CONFIG, ...args.config };
  const speed: Speed = speedOf(args.tc);
  const { ms, blur } = moveTimes(args.log, args.moves.length, args.tc);
  const g = new Game();
  const legal: number[] = [];
  for (const m of args.moves) {
    legal.push(g.legalMoves().length);
    if (!g.move(m)) break;
  }

  const side = (color: Color): SideScore => {
    const red = color === "red";
    const accs: number[] = [];
    let matches = 0;
    const times: number[] = [];
    const hard: number[] = [];
    const easy: number[] = [];
    let blurs = 0;
    let own = 0;
    args.moves.forEach((move, i) => {
      if ((i % 2 === 0) !== red) return;
      own++;
      if (blur[i]) blurs++;
      const t = ms[i];
      if (t != null) times.push(t);
      const ply = i + 1;
      if (ply < c.first_ply || ply > c.last_ply || legal[i] === 1) return;
      const before = args.analysis.positions[i]!;
      const after = args.analysis.positions[i + 1]!;
      const mine = (n: number) => (red ? winChance(n) : 1 - winChance(n));
      const loss = Math.max(0, mine(before.s[0]!) - mine(after.s[0]!));
      accs.push(perMoveAccuracy(before.b === move ? 0 : loss));
      if (before.b === move) matches++;
      // Difficulty: one good move among several lines is a hard position.
      if (t != null && before.s.length > 1) {
        const good = before.s.filter((s) => mine(before.s[0]!) - mine(s) <= c.good_move).length;
        (good === 1 ? hard : easy).push(t);
      }
    });

    const n = accs.length;
    const acc = n ? mean(accs) : null;
    const match = n ? matches / n : null;
    const widen = speed === "lightning" ? c.lightning_sd_factor : 1;
    const b = args.baselines[color];
    const z = n >= c.min_moves && acc !== null && match !== null ? ((acc - b.acc.mean) / (b.acc.sd * widen) + (match - b.match.mean) / (b.match.sd * widen)) / 2 : null;

    const timed = times.length >= c.min_timed;
    const cv = timed && mean(times) > 0 ? sd(times) / mean(times) : null;
    const fast = timed ? times.filter((t) => t < c.fast_ms).length / times.length : null;
    const focus = own >= c.min_moves ? blurs / own : null;
    const hardRatio = hard.length >= c.min_hard && easy.length >= c.min_hard && mean(easy) > 0 ? mean(hard) / mean(easy) : null;
    const flags: Flag[] = [];
    if (cv !== null && cv < c.even_times_cv) flags.push("even-times");
    // Rapid leaves time for everyone to think, so few fast moves says nothing there.
    if (fast !== null && speed !== "rapid" && fast < c.few_fast_share) flags.push("few-fast");
    if (focus !== null && focus > c.focus_share) flags.push("focus");
    if (hardRatio !== null && hardRatio < c.flat_difficulty_ratio) flags.push("flat-difficulty");
    const round = (x: number | null, d = 3) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);
    return {
      moves: n,
      acc: round(acc, 1),
      match: round(match),
      z: round(z, 2),
      flags,
      timing: { cv: round(cv), fast: round(fast), focus: round(focus), hard_ratio: round(hardRatio) },
    };
  };
  return { red: side("red"), black: side("black") };
}
