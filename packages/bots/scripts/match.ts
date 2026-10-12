// One bot-vs-bot game, played exactly as the site plays a bot's moves (BotGame.tsx): the
// engine analyses at the bot's depth and MultiPV, and chooseMove picks from the lines with
// the bot's book, blunder chance, temperature and style. Bundled by calibrate.mjs.
import { XiangqiEngine } from "@xq/engine";
import { Game } from "xiangqi-core";
import { type BotConfig, chooseMove } from "../src/index.js";

export { XiangqiEngine };

/** A finished game: 1 Red won, 0 Black won, 0.5 draw. */
export interface MatchResult {
  red: string;
  black: string;
  score: 1 | 0 | 0.5;
  reason: string;
  plies: number;
  moves: string[];
  /** Average engine time per move, per bot id. */
  msPerMove: Record<string, number>;
}

/** Far beyond a real game; the natural move limit normally ends one much sooner. */
const MAX_PLIES = 400;

export async function playGame(red: BotConfig, black: BotConfig, engines: { red: XiangqiEngine; black: XiangqiEngine }): Promise<MatchResult> {
  const game = new Game();
  const time: Record<string, { ms: number; n: number }> = { [red.id]: { ms: 0, n: 0 }, [black.id]: { ms: 0, n: 0 } };
  while (!game.result && game.history.length < MAX_PLIES) {
    const bot = game.turn === "red" ? red : black;
    const engine = game.turn === "red" ? engines.red : engines.black;
    const fen = game.fen;
    const t0 = performance.now();
    const r = await engine.analyze(fen, { depth: bot.strength.depth, multipv: bot.strength.multipv });
    time[bot.id]!.ms += performance.now() - t0;
    time[bot.id]!.n++;
    const choice = chooseMove({ bot, fen, lines: r.lines, history: game.history.map((m) => m.iccs) });
    if (!choice || !game.move(choice.move)) throw new Error(`${bot.id} found no move in ${fen}`);
  }
  const result = game.result;
  const score = !result || result.winner === null ? 0.5 : result.winner === "red" ? 1 : 0;
  return {
    red: red.id,
    black: black.id,
    score,
    reason: result?.reason ?? "move cap",
    plies: game.history.length,
    moves: game.history.map((m) => m.iccs),
    msPerMove: Object.fromEntries(Object.entries(time).map(([id, t]) => [id, Math.round(t.ms / Math.max(1, t.n))])),
  };
}
