// How the server decides a game's result from its log (docs/v0.3-online-design.md, "At the
// end" and "Disputes"). The log is the server's own timeline: every report a browser sent,
// stamped when it reached the queue. A browser's claim is accepted when it costs the claimant
// (resigning, a draw it agreed to, its own time-out), when the other browser says the same, or
// when the timeline bears it out (the opponent's clock had run out, or they'd been silent for
// their whole reconnect window). Otherwise the server waits for more reports, and a game that
// can't be settled ends with no result.
import { type Color, Game } from "xiangqi-core";
import { type Clocks, type Report } from "../protocol.js";
import { NO_RESULT, type OnlineReason, type OnlineResult, canMate, material, other, winOrDraw } from "../result.js";
import {
  EARLY_CLAIM_AFTER_MS,
  EARLY_CLAIM_MIN_WINDOW_MS,
  LAST_CHANCE_MS,
  MIN_RATED_PLIES,
  type TimeControl,
  reconnectWindowMs,
} from "../timeControl.js";

export interface LogRow {
  by: Color;
  kind: Report["kind"];
  ply: number | null;
  report: Report;
  /** Arrival time stamp, ms. */
  at: number;
}

export interface GameRow {
  tc: TimeControl;
  rated: boolean;
  /** When the game was created, ms. */
  startedAt: number;
}

/**
 * Sportsmanship labels (docs/v0.3-online-design.md, "Sportsmanship"): left and didn't come back;
 * let the clock run down in a lost position after idling longer than the reconnect window;
 * aborted, or let the first-move timer run out; spent over half the base time on one of the
 * first 10 moves. The first three count against the completion rate.
 */
export type Label = "abandoned" | "stalled" | "aborted" | "slow-start";
export type Labels = Partial<Record<Color, Label[]>>;

export type Decision =
  | {
      kind: "over";
      result: OnlineResult;
      moves: string[];
      rated: boolean;
      /** A claim that the log contradicted: flag for fair-play review. */
      flagged: Color | null;
      labels: Labels;
    }
  | { kind: "pending"; why: string };

/** Network slack allowed when comparing a browser's timing with the server's time stamps. */
export const TIMELINE_SLACK_MS = 3_000;

type End = Extract<Report, { kind: "end" }>;

/** The moves as the log has them: each ply from its mover's own reports, later takebacks included. */
export function movesFromLog(log: readonly LogRow[]): { moves: string[]; illegal: { by: Color; ply: number } | null; at: number[] } {
  const moves: string[] = [];
  const at: number[] = [];
  for (const row of log) {
    if (row.report.kind !== "move" || row.ply === null) continue;
    const mover: Color = row.ply % 2 === 1 ? "red" : "black";
    if (row.by !== mover || row.ply < 1 || row.ply > moves.length + 1) continue;
    moves.length = row.ply - 1; // a takeback reports a ply again
    at.length = row.ply - 1;
    moves.push(row.report.iccs);
    at.push(row.at);
  }
  const g = new Game();
  for (const [i, m] of moves.entries()) {
    if (g.result || !g.move(m)) return { moves: moves.slice(0, i), illegal: { by: i % 2 === 0 ? "red" : "black", ply: i + 1 }, at: at.slice(0, i) };
  }
  return { moves, illegal: null, at };
}

const replay = (moves: readonly string[]): Game | null => {
  const g = new Game();
  for (const m of moves) if (g.result || !g.move(m)) return null;
  return g;
};

const sameResult = (a: OnlineResult, b: OnlineResult) => a.winner === b.winner && a.reason === b.reason;

export function decide(game: GameRow, log: readonly LogRow[], now: number): Decision {
  const ends: Partial<Record<Color, { end: End; at: number }>> = {};
  for (const row of log) if (row.report.kind === "end") ends[row.by] = { end: row.report, at: row.at };
  const fromLog = movesFromLog(log);
  const over = (result: OnlineResult, moves: string[], flagged: Color | null = null): Decision => ({
    kind: "over",
    result,
    moves,
    rated: game.rated && !NO_RESULT.has(result.reason) && moves.length >= MIN_RATED_PLIES,
    flagged,
    labels: labelsOf(game, log, fromLog, result, moves),
  });

  // An illegal move in the log loses the game for the browser that made it.
  if (fromLog.illegal) return over({ winner: other(fromLog.illegal.by), reason: "illegal-move" }, fromLog.moves, fromLog.illegal.by);

  // The moves: the log's, or a reporter's own list where the log is behind it (reports lost while the server was down).
  const movesOf = (e: End): string[] | null => {
    if (e.moves.length < fromLog.moves.length || fromLog.moves.some((m, i) => e.moves[i] !== m)) return null;
    return replay(e.moves) ? e.moves : null;
  };

  // The rules decide first: if the moves end the game, nothing else matters.
  for (const c of ["red", "black"] as const) {
    const e = ends[c];
    const moves = e ? movesOf(e.end) : null;
    const g = moves && replay(moves);
    if (moves && g?.result) return over({ winner: g.result.winner, reason: g.result.reason }, moves);
  }
  const g0 = replay(fromLog.moves)!;
  if (g0.result) return over({ winner: g0.result.winner, reason: g0.result.reason }, fromLog.moves);

  const red = ends.red;
  const black = ends.black;
  if (!red && !black) return { kind: "pending", why: "no end report yet" };

  // Both browsers say the same: accepted (after the checks on what a pair could fake together).
  if (red && black && sameResult(red.end.result, black.end.result)) {
    const moves = movesOf(red.end) ?? movesOf(black.end) ?? fromLog.moves;
    // Who was at fault counts only if both browsers name the same side.
    const { by: _, ...plain } = red.end.result;
    const r: OnlineResult = red.end.result.by && red.end.result.by === black.end.result.by ? red.end.result : plain;
    if (r.reason === "aborted" && moves.length >= 2) return over({ winner: null, reason: "no-result" }, moves);
    if (r.reason === "agreement" && game.rated && moves.length < 20) return over({ winner: null, reason: "no-result" }, moves);
    return over(r, moves);
  }

  // One browser's claim (the other's report missing or different): check it against the timeline.
  const verdicts: Decision[] = [];
  for (const [c, e] of [["red", red], ["black", black]] as const) {
    if (!e) continue;
    const v = checkClaim(game, log, fromLog, c, e.end, e.at, now);
    if (v) verdicts.push(v);
  }
  const agreed = verdicts.find((v) => v.kind === "over");
  if (agreed) return agreed;
  // Two reports that disagree and neither checks out: no result, once the window for any more reports has passed.
  if (red && black) return over({ winner: null, reason: "no-result" }, fromLog.moves);
  return verdicts[0] ?? { kind: "pending", why: "claim not borne out yet" };

  function checkClaim(game: GameRow, log: readonly LogRow[], fl: ReturnType<typeof movesFromLog>, by: Color, e: End, endAt: number, now: number): Decision | null {
    const r = e.result;
    const moves = movesOf(e) ?? fl.moves;
    const g = replay(moves) ?? g0;
    const opp = other(by);
    const costsMe = r.winner === opp || (r.winner === null && !canMate(g, by));
    switch (r.reason as OnlineReason) {
      case "resign":
        // Only my own resignation needs no witness.
        return r.winner === opp ? over(r, moves) : { kind: "pending", why: "resignation not confirmed" };
      case "aborted":
        // Alone, a browser is believed only about its own abort.
        return moves.length < 2
          ? over({ winner: null, reason: "aborted", ...(r.by === by ? { by } : {}) }, moves)
          : over({ winner: null, reason: "no-result" }, moves, by);
      case "agreement":
        return { kind: "pending", why: "draw not confirmed by the other player" };
      case "timeout": {
        const loser = g.turn;
        if (r.winner !== null && r.winner !== other(loser)) return over({ winner: null, reason: "no-result" }, moves, by);
        if (loser === by) return over(winOrDraw(g, opp, "timeout"), moves); // my own flag
        // The loser's clock, as of the last move's arrival: had it run out by the time the claim arrived?
        const last = lastMoveBy(log, other(loser), moves.length);
        if (!last) return { kind: "pending", why: "no move on record to time from" };
        const left = last.clocks[loser];
        if (endAt + TIMELINE_SLACK_MS >= last.at + left) return over(winOrDraw(g, by, "timeout"), moves);
        return now > last.at + left + 60_000 ? over({ winner: null, reason: "no-result" }, moves, by) : { kind: "pending", why: "clock not run out on the server's timeline" };
      }
      case "abandoned":
      case "claim-draw": {
        if (costsMe && r.reason === "abandoned") return over(r, moves);
        // The opponent must have been silent for their whole window (or the early claim and its last 30 s).
        const lastHeard = Math.max(game.startedAt, ...log.filter((l) => l.by === opp).map((l) => l.at));
        const m = material(g);
        const window = reconnectWindowMs(game.tc, { downMaterial: m[opp] <= m[by] - 4 });
        const needed = window > EARLY_CLAIM_MIN_WINDOW_MS ? EARLY_CLAIM_AFTER_MS + LAST_CHANCE_MS : window;
        // A closed tab cuts the wait to 10 s; the server can't see that, so it accepts 10 s and flags short waits for review.
        const silent = endAt - lastHeard + TIMELINE_SLACK_MS;
        const result: OnlineResult = r.reason === "claim-draw" ? { winner: null, reason: "claim-draw", by: opp } : winOrDraw(g, by, "abandoned", opp);
        if (silent >= needed) return over(result, moves);
        if (silent >= 10_000) return over(result, moves, silent < needed ? by : null);
        return { kind: "pending", why: "opponent not silent long enough" };
      }
      default:
        return { kind: "pending", why: `"${r.reason}" isn't something one browser can claim` };
    }
  }
}

/** The sportsmanship labels a finished game earns each side. */
function labelsOf(game: GameRow, log: readonly LogRow[], fl: ReturnType<typeof movesFromLog>, result: OnlineResult, moves: readonly string[]): Labels {
  const out: Labels = {};
  const add = (c: Color, l: Label) => {
    if (!out[c]?.includes(l)) (out[c] ??= []).push(l);
  };
  if (result.by && (result.reason === "aborted" || result.reason === "abandoned" || result.reason === "claim-draw")) {
    add(result.by, result.reason === "aborted" ? "aborted" : "abandoned");
  }
  // Stalling: lost on time, behind on material, after a final turn longer than the reconnect window.
  const g = replay(moves);
  if (result.reason === "timeout" && g) {
    const loser = g.turn;
    const m = material(g);
    const last = lastMoveBy(log, other(loser), moves.length);
    if (last && m[loser] < m[other(loser)] && last.clocks[loser] > reconnectWindowMs(game.tc)) add(loser, "stalled");
  }
  // Each side's first 10 moves (plies 2 to 20; the first move has its own timer), timed by arrival.
  for (let ply = 2; ply <= Math.min(20, fl.at.length); ply++) {
    if (fl.at[ply - 1]! - fl.at[ply - 2]! > (game.tc.base * 1000) / 2) add(ply % 2 === 1 ? "red" : "black", "slow-start");
  }
  return out;
}

function lastMoveBy(log: readonly LogRow[], mover: Color, plies: number): { at: number; clocks: Clocks } | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const row = log[i]!;
    if (row.report.kind === "move" && row.by === mover && row.ply === plies) return { at: row.at, clocks: row.report.clocks };
  }
  return null;
}
