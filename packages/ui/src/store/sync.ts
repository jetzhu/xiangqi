// The account side of the Store (M11, M12). A signed-in browser keeps working from IndexedDB as
// a guest does: every write lands in a local cache first, so pages never wait for the network,
// and goes into an outbox that is sent to the account and retried until it succeeds. On each
// sign-in or page load the browser pulls the account's data into the cache.
//
// Lesson progress, stars, streak days, daily puzzles, Rush bests, saved analyses and settings
// are written by the player directly. Finished bot games and puzzle attempts go to the `record`
// server function, which checks them and works out the ratings (M12): the browser shows its own
// rating at once, and the server's replaces it. A bot game still in progress stays on this device.
import { NEW_PLAYER, type Rating } from "@xq/puzzles";
import type { SavedAnalysis } from "../analysis/storage.js";
import { type BotRating, MIN_PLIES } from "../bots/rating.js";
import type { Stars } from "../bots/stars.js";
import type { Progress } from "../learn/progress.js";
import type { PuzzleRecord, PuzzleState } from "../puzzles/store.js";
import type { GameRecord } from "./index.js";
import type { ClearableKV, KV, Namespace } from "./kv.js";

export interface PlayerState {
  stars: Stars;
  rush: Record<string, number>;
  activity: string[];
  daily: string[];
}
export type StateKey = keyof PlayerState;
export type SyncedSettings = Record<string, unknown>;

/** Results and ratings as the server recorded them. */
export interface Records {
  /** Finished bot games, newest first. */
  games: GameRecord[];
  /** Puzzle attempts, oldest first. */
  puzzles: PuzzleRecord[];
  botRating: BotRating | null;
  puzzleRating: Rating | null;
}

/** What the account holds. */
export interface Snapshot {
  lessons: Progress;
  state: Partial<PlayerState>;
  analyses: SavedAnalysis[];
  settings: SyncedSettings | null;
  records: Records;
  /** The player asked for the account to be deleted (M14); signing in cancels it. */
  deletionPending: boolean;
}

/** A puzzle attempt, as the server function takes it. */
export interface PuzzleAttempt {
  clientId: string;
  puzzleId: string;
  score: 0 | 0.5 | 1;
  rated: boolean;
  moves: string[];
  at: string;
}

/** The account on the server (Supabase in the site, a fake in tests). */
export interface Remote {
  pull(): Promise<Snapshot>;
  /** Sends every lesson status; the server keeps the better one. Empty progress resets them all. */
  lessons(p: Progress): Promise<Progress>;
  /** Sends a whole value; the server merges it with its own and returns the result. */
  state<K extends StateKey>(key: K, value: PlayerState[K]): Promise<PlayerState[K]>;
  saveAnalysis(a: SavedAnalysis): Promise<void>;
  removeAnalysis(id: string): Promise<void>;
  settings(data: SyncedSettings): Promise<void>;
  /** Records a finished bot game; returns the rating change and the bot rating now. */
  recordGame(g: GameRecord): Promise<{ rated: boolean; ratingBefore: number | null; ratingAfter: number | null; rating: BotRating }>;
  /** Records a puzzle attempt; returns the puzzle rating now. */
  recordPuzzle(a: PuzzleAttempt): Promise<{ rated: boolean; ratingAfter: number; rating: Rating }>;
  /** The answer to the skill question; false if the account already has ratings. */
  startingRating(rating: number): Promise<boolean>;
}

/** A write the server refused for good (bad data): dropped instead of retried forever. */
export class Rejected extends Error {}

/** Store keys that live in player_state, as [namespace, key, row key]. */
const STATE: [Namespace, string, StateKey][] = [
  ["bots", "stars", "stars"],
  ["local", "xq:rush:v1", "rush"],
  ["local", "xq:activity:v1", "activity"],
  ["local", "xq:daily:v1", "daily"],
];
const stateKey = (ns: Namespace, key: string) => STATE.find(([n, k]) => n === ns && k === key)?.[2];
/** Kept in the account's cache (cleared at sign-out); the rest stays on this device. */
const cached = (ns: Namespace, key: string) =>
  ns === "lessons" || ns === "analyses" || ns === "games" || ns === "puzzles" || ns === "ratings" || stateKey(ns, key) !== undefined;

interface Entry {
  ns: Namespace | "settings";
  key: string;
  value?: unknown;
  deleted?: true;
  seq: number;
}

export interface AccountSync {
  /** What the Store reads and writes for this account. */
  kv: KV;
  /** Sends the outbox; true when nothing is left to send. Never throws. */
  flush(): Promise<boolean>;
  /**
   * Fresh account data into the cache (after sending the outbox). Null when offline. `settings`
   * is "pending" when a newer change from this browser is still on its way. `newPlayer`: the
   * account has no ratings yet, so the skill question applies.
   */
  pull(): Promise<{ changed: boolean; settings: SyncedSettings | null | "pending"; newPlayer: boolean; deletionPending: boolean } | null>;
  /** Saves settings to the account (through the outbox). */
  saveSettings(data: SyncedSettings): Promise<void>;
  /** Sets the starting ratings (the skill question), then pulls them. False if too late. */
  startingRating(rating: number): Promise<boolean>;
  /** Forgets this account's cached data and unsent writes (sign-out). Device records stay. */
  clear(): Promise<void>;
  /** Stops retrying (the account was switched or signed out). */
  stop(): void;
}

export interface SyncParts {
  /** The account's data, cleared at sign-out. */
  cache: ClearableKV;
  /** Writes waiting to be sent. */
  outbox: ClearableKV;
  /** Bot games in progress on this device. */
  device: KV;
  remote: () => Promise<Remote>;
}

const RETRY_MS = [2_000, 5_000, 15_000, 60_000];
let seqCounter = 0;

/** A puzzle attempt the server can check: one named, with its moves (from M12 on). */
const sendable = (h: PuzzleRecord): h is PuzzleRecord & { clientId: string } => typeof h.clientId === "string" && Array.isArray(h.moves);

export function accountSync({ cache, outbox, device, remote }: SyncParts): AccountSync {
  let running: Promise<boolean> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let stopped = false;

  const later = (ms: number) => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), ms);
  };

  const enqueue = async (e: Omit<Entry, "seq">) => {
    await outbox.set("local", `${e.ns}/${e.key}`, { ...e, seq: Date.now() * 1000 + (seqCounter++ % 1000) });
    later(300);
  };
  const pendingKeys = async () => new Set((await outbox.entries("local")).map(([k]) => k));
  const anyPending = (keys: Set<string>, prefix: string) => [...keys].some((k) => k.startsWith(prefix));

  /** Sends one entry; returns what to write to the cache if nothing newer was written meanwhile. */
  const send = async (r: Remote, e: Entry): Promise<(() => Promise<void>) | null> => {
    if (e.ns === "settings") return void (await r.settings(e.value as SyncedSettings)), null;
    if (e.ns === "lessons") {
      const sent = (e.value ?? {}) as Progress;
      const back = { ...sent, ...(await r.lessons(sent)) };
      return () => cache.set("lessons", e.key, back);
    }
    if (e.ns === "analyses") return void (await (e.deleted ? r.removeAnalysis(e.key) : r.saveAnalysis(e.value as SavedAnalysis))), null;
    if (e.ns === "games") {
      const g = e.value as GameRecord;
      const out = await r.recordGame(g);
      return async () => {
        await cache.set("games", g.id, { ...g, rated: out.rated, ratingBefore: out.ratingBefore, ratingAfter: out.ratingAfter });
        // The server's rating, unless more games are on their way (it would go back, then forward).
        if (!anyPending(await pendingKeys(), "games/")) await cache.set("ratings", "bot", out.rating);
      };
    }
    if (e.ns === "puzzles") {
      const a = e.value as PuzzleAttempt;
      const out = await r.recordPuzzle(a);
      return async () => {
        const s = await cache.get<PuzzleState>("puzzles", "state");
        if (!s) return;
        const history = s.history.map((h) => (h.clientId === a.clientId ? { ...h, rated: out.rated, ratingAfter: out.ratingAfter } : h));
        const settled = !anyPending(await pendingKeys(), "puzzles/");
        await cache.set("puzzles", "state", { rating: settled ? out.rating : s.rating, history });
      };
    }
    const k = stateKey(e.ns, e.key);
    if (!k) return null;
    const merged = await r.state(k, e.value as never);
    return () => cache.set(e.ns as Namespace, e.key, merged);
  };

  const drain = async () => {
    const pending = await outbox.entries<Entry>("local");
    if (pending.length === 0) return true;
    const r = await remote();
    for (const [id, e] of pending.sort(([, a], [, b]) => a.seq - b.seq)) {
      let apply: (() => Promise<void>) | null;
      try {
        apply = await send(r, e);
      } catch (err) {
        if (!(err instanceof Rejected)) throw err;
        apply = null;
      }
      // Only if nothing newer was written meanwhile: drop the entry, keep the server's answer.
      if ((await outbox.get<Entry>("local", id))?.seq === e.seq) {
        await outbox.del("local", id);
        await apply?.();
      }
    }
    return (await outbox.entries("local")).length === 0;
  };

  const flush = (): Promise<boolean> =>
    (running ??= (async () => {
      try {
        const done = await drain();
        failures = 0;
        if (!done) later(300);
        return done;
      } catch {
        later(RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)]!);
        return false;
      } finally {
        running = null;
      }
    })());

  /** New attempts in a saved puzzle record (not in the cached one) go to the server. */
  const sendAttempts = async (next: PuzzleState) => {
    const before = new Set(((await cache.get<PuzzleState>("puzzles", "state"))?.history ?? []).map((h) => h.clientId));
    return next.history.filter((h) => sendable(h) && !before.has(h.clientId)) as (PuzzleRecord & { clientId: string; moves: string[] })[];
  };

  const kv: KV = {
    async get(ns, key) {
      if (ns === "games") return (await cache.get(ns, key)) ?? device.get(ns, key);
      return (cached(ns, key) ? cache : device).get(ns, key);
    },
    async entries<T>(ns: Namespace) {
      if (ns === "analyses") return cache.entries<T>(ns);
      if (ns !== "games") return device.entries<T>(ns);
      // Games in progress here, then the finished ones.
      return [...new Map([...(await device.entries<T>(ns)), ...(await cache.entries<T>(ns))])];
    },
    async set(ns, key, value) {
      if (!cached(ns, key)) return device.set(ns, key, value);
      if (ns === "games") {
        const g = value as GameRecord;
        if (g.result === null) return device.set(ns, key, value);
        await cache.set(ns, key, value);
        await device.del(ns, key);
        if (g.moves.length >= MIN_PLIES) await enqueue({ ns, key, value });
        return;
      }
      if (ns === "puzzles") {
        const fresh = await sendAttempts(value as PuzzleState);
        await cache.set(ns, key, value);
        for (const h of fresh) {
          const a: PuzzleAttempt = { clientId: h.clientId, puzzleId: h.id, score: h.score, rated: h.rated === true, moves: h.moves, at: h.at };
          await enqueue({ ns, key: `attempt/${h.clientId}`, value: a });
        }
        return;
      }
      await cache.set(ns, key, value);
      // The bot rating is the server's to work out: kept here until its answer comes.
      if (ns !== "ratings") await enqueue({ ns, key, value });
    },
    async del(ns, key) {
      if (!cached(ns, key)) return device.del(ns, key);
      await cache.del(ns, key);
      if (ns === "games") return device.del(ns, key);
      if (ns !== "ratings" && ns !== "puzzles") await enqueue({ ns, key, deleted: true });
    },
  };

  /**
   * Records kept on this device before the server could check them (M11): finished games are
   * sent now, in the order they were played, and re-rated by the server. Puzzle attempts from
   * then have no moves to check, so they and the device's ratings are dropped.
   */
  const adoptDevice = async () => {
    const games = (await device.entries<GameRecord>("games")).map(([, g]) => g).filter((g) => g.result !== null);
    for (const g of games.sort((a, b) => a.startedAt.localeCompare(b.startedAt))) await kv.set("games", g.id, g);
    await device.del("puzzles", "state");
    await device.del("ratings", "bot");
  };

  const pull = async () => {
    await adoptDevice();
    if (!(await flush())) return null;
    let snap: Snapshot;
    try {
      snap = await (await remote()).pull();
    } catch {
      return null;
    }
    // A write made while the pull was on its way wins over what the pull brought.
    const pending = await pendingKeys();
    let changed = false;
    const put = async (ns: Namespace, key: string, value: unknown) => {
      if (pending.has(`${ns}/${key}`)) return;
      if (JSON.stringify(await cache.get(ns, key)) === JSON.stringify(value)) return;
      changed = true;
      await (value === undefined ? cache.del(ns, key) : cache.set(ns, key, value));
    };
    await put("lessons", "progress", snap.lessons);
    for (const [ns, key, k] of STATE) await put(ns, key, snap.state[k]);
    const ids = new Set(snap.analyses.map((a) => a.id));
    for (const a of snap.analyses) await put("analyses", a.id, a);
    for (const [id] of await cache.entries("analyses")) if (!ids.has(id)) await put("analyses", id, undefined);

    const { records } = snap;
    if (!anyPending(pending, "games/")) {
      const games = new Set(records.games.map((g) => g.id));
      for (const g of records.games) await put("games", g.id, g);
      for (const [id] of await cache.entries("games")) if (!games.has(id)) await put("games", id, undefined);
      await put("ratings", "bot", records.botRating ?? undefined);
    }
    if (!anyPending(pending, "puzzles/")) {
      const any = records.puzzleRating !== null || records.puzzles.length > 0;
      await put("puzzles", "state", any ? { rating: records.puzzleRating ?? NEW_PLAYER, history: records.puzzles } : undefined);
    }
    return {
      changed,
      settings: pending.has("settings/data") ? ("pending" as const) : snap.settings,
      newPlayer: records.botRating === null && records.puzzleRating === null && records.games.length === 0 && records.puzzles.length === 0,
      deletionPending: snap.deletionPending,
    };
  };

  return {
    kv,
    flush,
    pull,
    saveSettings: (data) => enqueue({ ns: "settings", key: "data", value: data }),
    async startingRating(rating) {
      const ok = await (await remote()).startingRating(rating);
      await pull();
      return ok;
    },
    async clear() {
      stopped = true;
      clearTimeout(timer);
      await Promise.all([cache.clear(), outbox.clear()]);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
