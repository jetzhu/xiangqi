// Recording bot games: finishing a game (rating it if rated) and settling rated games the
// player walked away from. Games shorter than MIN_PLIES are neither saved nor rated.
import type { GameRecord, Store } from "../store/index.js";
import { MIN_PLIES, rateBotGame } from "./rating.js";

const SCORE = { win: 1, draw: 0.5, loss: 0 } as const;

/**
 * Games being finished right now. A game claims itself the moment it ends (synchronously), so
 * settleAbandoned() — which may run as the player goes back to the bot list — can't count the
 * same game a second time while its own finish is still saving.
 */
const finishing = new Set<string>();
export const claimGame = (id: string) => void finishing.add(id);

/** Close a game: rate it if it counts, save it if it is long enough. Returns the final record. */
export async function finishGame(
  store: Store,
  rec: GameRecord,
  result: "win" | "loss" | "draw",
  reason: string,
  at = new Date(),
): Promise<GameRecord> {
  finishing.add(rec.id);
  try {
    return await close(store, rec, result, reason, at);
  } finally {
    finishing.delete(rec.id);
  }
}

async function close(store: Store, rec: GameRecord, result: "win" | "loss" | "draw", reason: string, at: Date): Promise<GameRecord> {
  let out: GameRecord = { ...rec, result, reason, endedAt: at.toISOString() };
  if (rec.moves.length < MIN_PLIES) return out;
  if (rec.rated) {
    const before = await store.botRating.load();
    const after = rateBotGame(before, rec.botRating, SCORE[result], at);
    await store.botRating.save(after);
    out = { ...out, ratingBefore: before.rating, ratingAfter: after.rating };
  }
  await store.games.put(out);
  return out;
}

/**
 * Rated games still marked in progress were left by closing the tab or navigating away:
 * each counts as a loss (as on chess.com), so a rating can't be protected by leaving.
 * Returns how many were settled.
 */
export async function settleAbandoned(store: Store, at = new Date()): Promise<number> {
  const open = (await store.games.list()).filter((g) => g.result === null && g.rated && !finishing.has(g.id));
  // Oldest first, so the rating changes apply in the order the games were played.
  for (const g of open.reverse()) await finishGame(store, g, "loss", "abandoned", at);
  return open.length;
}
