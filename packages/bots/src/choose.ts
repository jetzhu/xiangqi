import type { AnalysisLine } from "@xq/engine";
import { Position, START_FEN, parseIccs, parseSquare, toIccs, CANNON, SOLDIER } from "xiangqi-core";
import type { BotConfig, ChatEvent, Text } from "./types.js";

export interface ChooseInput {
  bot: BotConfig;
  /** Position the bot moves in. */
  fen: string;
  /** Engine lines for `fen` (Red's-view scores, ICCS moves). */
  lines: readonly AnalysisLine[];
  /** Moves played so far from the standard start (for the opening book), or null if the game began elsewhere. */
  history: readonly string[] | null;
  /** Random number generator in [0, 1). */
  rng?: () => number;
}

export interface Choice {
  move: string;
  source: "book" | "engine" | "random";
}

const MATE = 20000;

/** Pick the bot's move: opening book, then (rarely) a random move, else a sampled engine line. */
export function chooseMove({ bot, fen, lines, history, rng = Math.random }: ChooseInput): Choice | null {
  const pos = Position.fromFen(fen);
  const legalIccs = pos.legalMoves().map(toIccs);
  if (legalIccs.length === 0) return null;

  // 1. Opening book: continue a preferred line while the game follows it.
  if (history) {
    const next = bot.book
      .filter((line) => line.length > history.length && history.every((m, i) => line[i] === m))
      .map((line) => line[history.length]!)
      .filter((m) => legalIccs.includes(m));
    if (next.length) return { move: next[Math.floor(rng() * next.length)]!, source: "book" };
  }

  // 2. An occasional random move (how beginners lose material).
  if (bot.strength.blunderChance > 0 && rng() < bot.strength.blunderChance) {
    return { move: legalIccs[Math.floor(rng() * legalIccs.length)]!, source: "random" };
  }

  // 3. Sample among the engine's candidates.
  const sign = pos.turn === 1 ? 1 : -1;
  const cands = lines
    .filter((l) => l.pv[0] && legalIccs.includes(l.pv[0]))
    .map((l) => {
      const s = l.score.mate !== undefined ? Math.sign(l.score.mate) * (MATE - Math.abs(l.score.mate) * 100) : l.score.cp;
      return { move: l.pv[0]!, score: s * sign };
    });
  if (cands.length === 0) return { move: legalIccs[Math.floor(rng() * legalIccs.length)]!, source: "random" };
  const best = Math.max(...cands.map((c) => c.score));
  const pool = cands
    .filter((c) => best - c.score <= bot.strength.maxLoss)
    .map((c) => ({ ...c, value: c.score + styleBonus(pos, c.move, bot) }));
  const T = bot.strength.temperature;
  if (T <= 0) return { move: pool.reduce((a, b) => (b.value > a.value ? b : a)).move, source: "engine" };
  const top = Math.max(...pool.map((c) => c.value));
  const weights = pool.map((c) => Math.exp((c.value - top) / T));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return { move: pool[i]!.move, source: "engine" };
  }
  return { move: pool.at(-1)!.move, source: "engine" };
}

/** Centipawn bonus for a move according to the bot's style. */
export function styleBonus(pos: Position, iccs: string, bot: BotConfig): number {
  const from = parseSquare(iccs.slice(0, 2));
  const to = parseSquare(iccs.slice(2, 4));
  const piece = Math.abs(pos.board[from]!);
  const st = bot.style;
  let bonus = 0;
  if (pos.board[to] !== 0) bonus += st.captures;
  if (piece === CANNON) bonus += st.cannon;
  if (piece === SOLDIER && (Math.floor(to / 9) - Math.floor(from / 9)) * pos.turn > 0) bonus += st.advance;
  if (st.checks) {
    const m = parseIccs(pos, iccs);
    if (m !== null) {
      const side = pos.turn;
      const u = pos.make(m);
      if (pos.isInCheck(side === 1 ? -1 : 1)) bonus += st.checks;
      pos.unmake(m, u);
    }
  }
  return bonus;
}

/** A random chat line for an event. */
export function chatLine(bot: BotConfig, event: ChatEvent, rng: () => number = Math.random): Text | null {
  const lines = bot.chat[event];
  return lines?.length ? lines[Math.floor(rng() * lines.length)]! : null;
}

/** True when `fen` is the standard start (so the opening book applies). */
export const isStandardStart = (fen: string) => fen.split(" ")[0] === START_FEN.split(" ")[0];
