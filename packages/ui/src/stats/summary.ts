// Figures for the stats page, computed from saved games (pure, so they can be tested).
import type { PuzzleRecord } from "../puzzles/store.js";
import type { GameRecord } from "../store/index.js";

export interface Tally {
  games: number;
  wins: number;
  draws: number;
  losses: number;
}
const empty = (): Tally => ({ games: 0, wins: 0, draws: 0, losses: 0 });
const add = (t: Tally, g: GameRecord) => {
  t.games++;
  if (g.result === "win") t.wins++;
  else if (g.result === "draw") t.draws++;
  else t.losses++;
};

export interface Summary {
  all: Tally;
  red: Tally;
  black: Tally;
  byBot: Record<string, Tally>;
  /** The strongest bot beaten (by its rating at the time), with the game. */
  bestWin: GameRecord | null;
  longestWinStreak: number;
  /** Rated games in play order, for the rating chart. */
  ratingHistory: { at: string; rating: number }[];
}

/** Summarise finished games (unfinished ones are ignored). */
export function summarize(games: readonly GameRecord[]): Summary {
  const done = games.filter((g) => g.result !== null).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const s: Summary = { all: empty(), red: empty(), black: empty(), byBot: {}, bestWin: null, longestWinStreak: 0, ratingHistory: [] };
  let run = 0;
  for (const g of done) {
    add(s.all, g);
    add(s[g.playerColor], g);
    add((s.byBot[g.botId] ??= empty()), g);
    if (g.result === "win") {
      run++;
      s.longestWinStreak = Math.max(s.longestWinStreak, run);
      if (!s.bestWin || g.botRating > s.bestWin.botRating) s.bestWin = g;
    } else run = 0;
    if (g.rated && g.ratingAfter !== null) s.ratingHistory.push({ at: g.endedAt ?? g.startedAt, rating: g.ratingAfter });
  }
  return s;
}

/** Points from `since` on (ISO time), or all of them when `since` is null. */
export function since<T extends { at: string }>(points: readonly T[], from: string | null): T[] {
  return from === null ? [...points] : points.filter((p) => p.at >= from);
}

export const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((100 * part) / whole));

export interface GameFilter {
  botId: string | "all";
  result: "all" | "win" | "loss" | "draw";
  color: "all" | "red" | "black";
  type: "all" | "rated" | "casual";
}
export const NO_FILTER: GameFilter = { botId: "all", result: "all", color: "all", type: "all" };

export function filterGames(games: readonly GameRecord[], f: GameFilter): GameRecord[] {
  return games.filter(
    (g) =>
      g.result !== null &&
      (f.botId === "all" || g.botId === f.botId) &&
      (f.result === "all" || g.result === f.result) &&
      (f.color === "all" || g.playerColor === f.color) &&
      (f.type === "all" || (f.type === "rated") === g.rated),
  );
}

export interface ThemeAccuracy {
  theme: string;
  /** Puzzles tried with this theme (first tries only). */
  tried: number;
  /** Of those, solved first time without a hint. */
  solved: number;
}

/**
 * Puzzle accuracy by theme, from first tries (a retry or a hint doesn't count as solved), most
 * tried first. Length tags (short, long, one move) are left out: they say nothing about skill.
 */
export function puzzleThemes(history: readonly PuzzleRecord[], themesOf: (id: string) => readonly string[] | undefined): ThemeAccuracy[] {
  const seen = new Set<string>();
  const by = new Map<string, ThemeAccuracy>();
  for (const h of history) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    for (const theme of themesOf(h.id) ?? []) {
      if (theme === "short" || theme === "long" || theme === "oneMove") continue;
      const a = by.get(theme) ?? { theme, tried: 0, solved: 0 };
      a.tried++;
      if (h.score === 1) a.solved++;
      by.set(theme, a);
    }
  }
  return [...by.values()].sort((a, b) => b.tried - a.tried || a.theme.localeCompare(b.theme));
}

/** The highest puzzle rating reached, and when. */
export function puzzlePeak(history: readonly PuzzleRecord[]): { rating: number; at: string } | null {
  let best: PuzzleRecord | null = null;
  for (const h of history) if (!best || h.ratingAfter > best.ratingAfter) best = h;
  return best && { rating: best.ratingAfter, at: best.at };
}
