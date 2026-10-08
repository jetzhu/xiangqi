// The one-time move of guest progress into an account, when a browser with guest progress
// signs in (the merge rules in the v0.2 accounts design). Afterwards the guest copy is cleared,
// so it can't be imported twice or into a second account.
import type { LessonStatus } from "../learn/progress.js";
import { type GameRecord, createStore } from "./index.js";
import type { KV } from "./kv.js";

export interface ImportSummary {
  /** Lessons started or mastered. */
  lessons: number;
  /** Puzzles attempted. */
  puzzles: number;
  /** Finished bot games. */
  games: number;
  analyses: number;
}

const RANK: Record<LessonStatus, number> = { new: 0, started: 1, mastered: 2 };
const LOCAL_KEYS = ["xq:activity:v1", "xq:daily:v1", "xq:rush:v1"];
const days = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort().slice(-400);

async function read(guest: KV) {
  const g = createStore(guest);
  const [lessons, stars, activity, daily, rush, analyses, games, puzzles] = await Promise.all([
    g.lessons.load(),
    g.stars.load(),
    g.activity.load(),
    g.daily.load(),
    g.rush.load(),
    g.analyses.list(),
    g.games.list(),
    g.puzzles.load(),
  ]);
  return { lessons, stars, activity, daily, rush, analyses, games: games.filter((x) => x.result !== null), allGames: games, puzzles };
}

/** Whether this browser holds guest progress worth moving into an account. */
export async function hasGuestData(guest: KV): Promise<boolean> {
  const d = await read(guest);
  return (
    Object.values(d.lessons).some((s) => s !== "new") ||
    Object.keys(d.stars).length > 0 ||
    Object.keys(d.rush).length > 0 ||
    d.activity.length > 0 ||
    d.daily.length > 0 ||
    d.analyses.length > 0 ||
    d.allGames.length > 0 ||
    d.puzzles.history.length > 0
  );
}

/** Moves guest progress into `account` (its store's KV), then clears the guest copy. */
export async function importGuest(guest: KV, account: KV): Promise<ImportSummary> {
  const d = await read(guest);
  const a = createStore(account);

  // Lessons: the better status for each.
  const progress = await a.lessons.load();
  let lessonsChanged = false;
  for (const [id, s] of Object.entries(d.lessons)) {
    if (RANK[s] > RANK[progress[id] ?? "new"]) {
      progress[id] = s;
      lessonsChanged = true;
    }
  }
  if (lessonsChanged) await account.set("lessons", "progress", progress);

  // Stars and Rush bests: the best of both. Streak and daily-puzzle days: all of them.
  if (Object.keys(d.stars).length) {
    const stars = await a.stars.load();
    for (const [id, n] of Object.entries(d.stars)) if ((stars[id] ?? 0) < n) stars[id] = n;
    await account.set("bots", "stars", stars);
  }
  if (Object.keys(d.rush).length) {
    const rush = await a.rush.load();
    for (const [mode, n] of Object.entries(d.rush) as [keyof typeof rush, number][]) if ((rush[mode] ?? 0) < n) rush[mode] = n;
    await account.set("local", "xq:rush:v1", rush);
  }
  if (d.activity.length) await account.set("local", "xq:activity:v1", days(await a.activity.load(), d.activity));
  if (d.daily.length) await account.set("local", "xq:daily:v1", days(await a.daily.load(), d.daily));

  // Saved analyses: all copied in.
  for (const x of d.analyses) await account.set("analyses", x.id, x);

  // Bot games join the history as casual games, so they don't change the account's bot rating.
  for (const g of d.games) {
    const casual: GameRecord = { ...g, rated: false, ratingBefore: null, ratingAfter: null };
    await account.set("games", g.id, casual);
  }

  // Puzzles: attempts join the history; the guest rating counts only if the account has none.
  if (d.puzzles.history.length) {
    const mine = await a.puzzles.load();
    const history = [...mine.history, ...d.puzzles.history].sort((x, y) => x.at.localeCompare(y.at));
    await account.set("puzzles", "state", { rating: mine.history.length ? mine.rating : d.puzzles.rating, history });
  }

  // Clear the guest copy.
  await Promise.all([
    guest.del("lessons", "progress"),
    guest.del("bots", "stars"),
    guest.del("bots", "crowns"),
    guest.del("puzzles", "state"),
    guest.del("ratings", "bot"),
    ...LOCAL_KEYS.map((k) => guest.del("local", k)),
    ...d.analyses.map((x) => guest.del("analyses", x.id)),
    ...d.allGames.map((g) => guest.del("games", g.id)),
  ]);

  return {
    lessons: Object.values(d.lessons).filter((s) => s !== "new").length,
    puzzles: d.puzzles.history.length,
    games: d.games.length,
    analyses: d.analyses.length,
  };
}
