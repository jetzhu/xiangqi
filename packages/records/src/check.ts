// What the server checks before it records a bot game or a puzzle attempt (M12): the moves
// must be legal and must back up the result claimed. A browser can still make up a game it
// never played, so this keeps records consistent rather than stopping a determined cheat; the
// bot rating is labelled practice for that reason.
import { type Puzzle, judge } from "@xq/puzzles";
import { Game } from "xiangqi-core";
import { MIN_PLIES } from "./botRating.js";

export type Outcome = "win" | "loss" | "draw";
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** A finished bot game as the browser reports it. */
export interface BotGameClaim {
  botId: string;
  playerColor: "red" | "black";
  /** ICCS, from the starting position. */
  moves: string[];
  result: Outcome;
  /** A rules ending ("checkmate", "repetition"…), or "resign", "abandoned" or "timeout". */
  reason: string;
}

/** The longest game accepted: far beyond any real game (the natural-limit rule ends one sooner). */
export const MAX_PLIES = 1000;

/**
 * Checks a bot game: a known bot, legal moves, and a result the moves support. Returns the
 * bot's rating from the site's own list, never the browser's.
 */
export function checkBotGame(c: BotGameClaim, bots: readonly { id: string; ratingLabel: number }[]): Checked<{ botRating: number }> {
  const bot = bots.find((b) => b.id === c.botId);
  if (!bot) return fail(`unknown bot "${c.botId}"`);
  if (c.playerColor !== "red" && c.playerColor !== "black") return fail("bad colour");
  if (!Array.isArray(c.moves) || c.moves.length < MIN_PLIES) return fail(`fewer than ${MIN_PLIES} moves`);
  if (c.moves.length > MAX_PLIES) return fail("too many moves");

  const g = new Game();
  for (const [i, m] of c.moves.entries()) {
    if (g.result) return fail(`moves after the game ended (ply ${i + 1})`);
    if (typeof m !== "string" || !g.move(m)) return fail(`illegal move "${String(m)}" at ply ${i + 1}`);
  }

  if (g.result) {
    // Ended by the rules: the final position says who won and why.
    const expected: Outcome = g.result.winner === null ? "draw" : g.result.winner === c.playerColor ? "win" : "loss";
    if (c.result !== expected || c.reason !== g.result.reason) return fail(`the final position is a ${expected} by ${g.result.reason}`);
  } else if (c.reason === "resign" || c.reason === "abandoned") {
    if (c.result !== "loss") return fail(`"${c.reason}" is a loss for the player`);
  } else if (c.reason === "timeout") {
    // The side to move is the one whose clock ran out.
    const expected: Outcome = g.turn === c.playerColor ? "loss" : "win";
    if (c.result !== expected) return fail(`on time, the side to move loses: a ${expected}`);
  } else {
    return fail(`the game isn't over, and "${c.reason}" doesn't end it`);
  }
  return { ok: true, value: { botRating: bot.ratingLabel } };
}

export type PuzzleScore = 0 | 0.5 | 1;

/**
 * Checks a puzzle attempt. A miss (0) is always believable; a solve (1, or 0.5 with a hint)
 * must play the solution through from the puzzle's position, the solver's moves only.
 */
export function checkPuzzleAttempt(p: Puzzle, moves: readonly string[], score: PuzzleScore): Checked<null> {
  if (score === 0) return { ok: true, value: null };
  if (score !== 1 && score !== 0.5) return fail("bad score");
  let fen = p.fen;
  for (const [k, move] of moves.entries()) {
    const i = 2 * k;
    if (i >= p.solution.length) return fail("moves after the puzzle was solved");
    const verdict = judge(p, i, fen, move);
    if (verdict === "complete") return k === moves.length - 1 ? { ok: true, value: null } : fail("moves after the puzzle was solved");
    if (verdict !== "correct") return fail(`move ${k + 1} is ${verdict}`);
    const g = new Game(fen);
    g.move(move);
    g.move(p.solution[i + 1]!);
    fen = g.fen;
  }
  return fail("the puzzle isn't solved");
}
