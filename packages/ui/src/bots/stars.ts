// Stars: the best result against each bot in this browser (IndexedDB; failures are ignored).
// As on chess.com, a win earns 3 stars with no help, 2 with 1–3 hints or takebacks, 1 with more.
import { createStore, get, set } from "idb-keyval";

export type Stars = Record<string, 1 | 2 | 3>;

const store = typeof indexedDB !== "undefined" ? createStore("xq-v1-bots", "bots") : undefined;

/** Stars for a win that used `helps` hints and takebacks. */
export function starsFor(helps: number): 1 | 2 | 3 {
  return helps === 0 ? 3 : helps <= 3 ? 2 : 1;
}

export async function loadStars(): Promise<Stars> {
  if (!store) return {};
  try {
    const stars = (await get<Stars>("stars", store)) ?? {};
    // Before stars, a win was a crown with no record of the help used: count it as 1 star.
    for (const id of (await get<string[]>("crowns", store)) ?? []) stars[id] ??= 1;
    return stars;
  } catch {
    return {};
  }
}

/** Record a win; keeps the best result. Returns the stars this win earned. */
export async function recordWin(botId: string, helps: number): Promise<1 | 2 | 3> {
  const earned = starsFor(helps);
  const stars = await loadStars();
  if ((stars[botId] ?? 0) < earned) stars[botId] = earned;
  try {
    if (store) await set("stars", stars, store);
  } catch {
    // storage blocked: the result just isn't remembered
  }
  return earned;
}
