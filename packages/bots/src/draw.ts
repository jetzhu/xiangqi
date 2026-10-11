import type { AnalysisLine } from "@xq/engine";
import type { BotConfig } from "./types.js";

/**
 * The bot's answer to a draw offer, from the engine's best line for the current position
 * (Red's-view score): it agrees when its own evaluation is no better than its `acceptsDrawAt`.
 * A forced mate decides outright: it never gives up its own, and always takes a draw against one.
 */
export function acceptsDraw(bot: BotConfig, botColor: "red" | "black", best: AnalysisLine | undefined): boolean {
  if (!best) return false;
  const sign = botColor === "red" ? 1 : -1;
  if (best.score.mate !== undefined) return best.score.mate * sign < 0;
  return (best.score.cp ?? 0) * sign <= bot.acceptsDrawAt;
}
