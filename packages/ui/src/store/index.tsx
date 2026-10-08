"use client";
// One storage layer for everything the site remembers about a player. Pages use useStore();
// today the data lives in this browser (browserKV), and in v0.2 an account store will sit
// behind the same interface. The pure rules (stars, streaks, ratings) live with their features;
// this module only reads and writes.
import { NEW_PLAYER } from "@xq/puzzles";
import { type ReactNode, createContext, useContext, useMemo } from "react";
import { type BotRating, NEW_BOT_RATING } from "../bots/rating.js";
import { type Stars, starsFor } from "../bots/stars.js";
import type { LessonStatus, Progress } from "../learn/progress.js";
import type { PuzzleState } from "../puzzles/store.js";
import type { RushMode } from "../puzzles/modes.js";
import type { SavedAnalysis } from "../analysis/storage.js";
import { dayOf } from "../streak.js";
import { type KV, browserKV } from "./kv.js";

/** One game against a bot. Saved once it has 4 plies; `result` is null while in progress. */
export interface GameRecord {
  id: string;
  botId: string;
  /** The bot's rating when the game was played. */
  botRating: number;
  playerColor: "red" | "black";
  moves: string[];
  result: "win" | "loss" | "draw" | null;
  /** How it ended: "checkmate", "stalemate", "resign", "timeout", "abandoned", a draw rule… */
  reason: string | null;
  rated: boolean;
  ratingBefore: number | null;
  ratingAfter: number | null;
  /** Hints and takebacks used. */
  helps: number;
  stars: number | null;
  startedAt: string;
  endedAt: string | null;
  /** From the post-game review, when it finished. */
  accuracy: number | null;
}

export interface Store {
  lessons: { load(): Promise<Progress>; setStatus(id: string, status: LessonStatus): Promise<Progress>; reset(): Promise<void> };
  stars: { load(): Promise<Stars>; recordWin(botId: string, helps: number): Promise<1 | 2 | 3> };
  puzzles: { load(): Promise<PuzzleState>; save(s: PuzzleState): Promise<void> };
  daily: { load(): Promise<string[]>; mark(day: string): Promise<string[]> };
  rush: { load(): Promise<Partial<Record<RushMode, number>>>; save(mode: RushMode, score: number): Promise<boolean> };
  activity: { load(): Promise<string[]>; record(now?: Date): Promise<void> };
  analyses: { list(): Promise<SavedAnalysis[]>; save(title: string, pgn: string): Promise<SavedAnalysis>; remove(id: string): Promise<void> };
  games: { list(): Promise<GameRecord[]>; get(id: string): Promise<GameRecord | undefined>; put(g: GameRecord): Promise<void> };
  botRating: { load(): Promise<BotRating>; save(r: BotRating): Promise<void> };
}

const quiet = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch {
    // storage blocked: not remembered
  }
};

export function createStore(kv: KV): Store {
  const activity = {
    load: async () => (await kv.get<string[]>("local", "xq:activity:v1")) ?? [],
    async record(now = new Date()) {
      const today = dayOf(now);
      const days = await activity.load();
      if (!days.includes(today)) await quiet(kv.set("local", "xq:activity:v1", [...days, today].slice(-400)));
    },
  };
  const stars = {
    async load(): Promise<Stars> {
      const s = (await kv.get<Stars>("bots", "stars")) ?? {};
      // Before stars, a win was a crown with no record of the help used: count it as 1 star.
      for (const id of (await kv.get<string[]>("bots", "crowns")) ?? []) s[id] ??= 1;
      return s;
    },
    async recordWin(botId: string, helps: number) {
      const earned = starsFor(helps);
      const s = await stars.load();
      if ((s[botId] ?? 0) < earned) s[botId] = earned;
      await quiet(kv.set("bots", "stars", s));
      return earned;
    },
  };
  const lessons = {
    load: async () => (await kv.get<Progress>("lessons", "progress")) ?? {},
    async setStatus(id: string, status: LessonStatus) {
      if (status === "mastered") await activity.record();
      const p = await lessons.load();
      if (p[id] === "mastered" && status !== "mastered") return p; // never downgrade
      p[id] = status;
      await quiet(kv.set("lessons", "progress", p));
      return p;
    },
    reset: () => quiet(kv.set("lessons", "progress", {})),
  };
  const daily = {
    load: async () => (await kv.get<string[]>("local", "xq:daily:v1")) ?? [],
    async mark(day: string) {
      const days = await daily.load();
      if (!days.includes(day)) await quiet(kv.set("local", "xq:daily:v1", [...days, day].slice(-400)));
      return daily.load();
    },
  };
  const rush = {
    load: async () => (await kv.get<Partial<Record<RushMode, number>>>("local", "xq:rush:v1")) ?? {},
    async save(mode: RushMode, score: number) {
      const best = await rush.load();
      if ((best[mode] ?? 0) >= score) return false;
      await quiet(kv.set("local", "xq:rush:v1", { ...best, [mode]: score }));
      return true;
    },
  };
  return {
    lessons,
    stars,
    activity,
    daily,
    rush,
    puzzles: {
      load: async () => (await kv.get<PuzzleState>("puzzles", "state")) ?? { rating: NEW_PLAYER, history: [] },
      save: (s) => quiet(kv.set("puzzles", "state", s)),
    },
    analyses: {
      async list() {
        return (await kv.entries<SavedAnalysis>("analyses")).map(([, v]) => v).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      },
      async save(title, pgn) {
        const item: SavedAnalysis = { id: crypto.randomUUID(), title: title.trim() || "Untitled analysis", pgn, savedAt: new Date().toISOString() };
        await kv.set("analyses", item.id, item); // throws when storage is blocked: the page says so
        return item;
      },
      remove: (id) => kv.del("analyses", id),
    },
    games: {
      async list() {
        return (await kv.entries<GameRecord>("games")).map(([, v]) => v).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      },
      get: (id) => kv.get<GameRecord>("games", id),
      put: (g) => quiet(kv.set("games", g.id, g)),
    },
    botRating: {
      load: async () => (await kv.get<BotRating>("ratings", "bot")) ?? NEW_BOT_RATING,
      save: (r) => quiet(kv.set("ratings", "bot", r)),
    },
  };
}

let browserStore: Store | null = null;
/** The store for this browser, created on first use. */
export const defaultStore = () => (browserStore ??= createStore(browserKV()));

const StoreContext = createContext<Store | null>(null);

/** Provide a store (tests pass createStore(memoryKV())); without one, pages use this browser's. */
export function StoreProvider({ store, children }: { store?: Store; children: ReactNode }) {
  const value = useMemo(() => store ?? defaultStore(), [store]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  return useContext(StoreContext) ?? defaultStore();
}

export { type KV, browserKV, memoryKV } from "./kv.js";
