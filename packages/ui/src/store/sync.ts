// The account side of the Store (M11). A signed-in browser keeps working from IndexedDB as a
// guest does: every write lands in a local cache first, so pages never wait for the network,
// and goes into an outbox that is sent to the account and retried until it succeeds. On each
// sign-in or page load the browser pulls the account's data into the cache.
//
// Synced now: lesson progress, stars, streak days, daily puzzles, Rush bests, saved analyses
// and settings. Bot games, puzzle history and the bot rating may only be written by server
// checks (M12), so until then they stay on this device, kept apart per account.
import type { SavedAnalysis } from "../analysis/storage.js";
import type { Stars } from "../bots/stars.js";
import type { Progress } from "../learn/progress.js";
import type { ClearableKV, KV, Namespace } from "./kv.js";

export interface PlayerState {
  stars: Stars;
  rush: Record<string, number>;
  activity: string[];
  daily: string[];
}
export type StateKey = keyof PlayerState;
export type SyncedSettings = Record<string, unknown>;

/** What the account holds: everything a player may write directly. */
export interface Snapshot {
  lessons: Progress;
  state: Partial<PlayerState>;
  analyses: SavedAnalysis[];
  settings: SyncedSettings | null;
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
const synced = (ns: Namespace, key: string) => ns === "lessons" || ns === "analyses" || stateKey(ns, key) !== undefined;

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
   * is "pending" when a newer change from this browser is still on its way.
   */
  pull(): Promise<{ changed: boolean; settings: SyncedSettings | null | "pending" } | null>;
  /** Saves settings to the account (through the outbox). */
  saveSettings(data: SyncedSettings): Promise<void>;
  /** Forgets this account's cached data and unsent writes (sign-out). Device records stay. */
  clear(): Promise<void>;
  /** Stops retrying (the account was switched or signed out). */
  stop(): void;
}

export interface SyncParts {
  /** The account's synced data, cleared at sign-out. */
  cache: ClearableKV;
  /** Writes waiting to be sent. */
  outbox: ClearableKV;
  /** Records kept on this device until M12 can check them (games, puzzles, bot rating). */
  device: KV;
  remote: () => Promise<Remote>;
}

const RETRY_MS = [2_000, 5_000, 15_000, 60_000];
let seqCounter = 0;

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

  const send = async (r: Remote, e: Entry): Promise<unknown> => {
    if (e.ns === "settings") return void (await r.settings(e.value as SyncedSettings));
    if (e.ns === "lessons") {
      const sent = (e.value ?? {}) as Progress;
      return { ...sent, ...(await r.lessons(sent)) };
    }
    if (e.ns === "analyses") return void (await (e.deleted ? r.removeAnalysis(e.key) : r.saveAnalysis(e.value as SavedAnalysis)));
    const k = stateKey(e.ns, e.key);
    return k ? r.state(k, e.value as never) : undefined;
  };

  const drain = async () => {
    const pending = await outbox.entries<Entry>("local");
    if (pending.length === 0) return true;
    const r = await remote();
    for (const [id, e] of pending.sort(([, a], [, b]) => a.seq - b.seq)) {
      let result: unknown;
      try {
        result = await send(r, e);
      } catch (err) {
        if (!(err instanceof Rejected)) throw err;
        result = undefined;
      }
      // Only if nothing newer was written meanwhile: drop the entry, keep the server's merge.
      if ((await outbox.get<Entry>("local", id))?.seq === e.seq) {
        await outbox.del("local", id);
        if (result !== undefined && e.ns !== "settings") await cache.set(e.ns, e.key, result);
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

  const kv: KV = {
    get: (ns, key) => (synced(ns, key) ? cache : device).get(ns, key),
    entries: (ns) => (ns === "analyses" ? cache : device).entries(ns),
    async set(ns, key, value) {
      if (!synced(ns, key)) return device.set(ns, key, value);
      await cache.set(ns, key, value);
      await enqueue({ ns, key, value });
    },
    async del(ns, key) {
      if (!synced(ns, key)) return device.del(ns, key);
      await cache.del(ns, key);
      await enqueue({ ns, key, deleted: true });
    },
  };

  const pull = async () => {
    if (!(await flush())) return null;
    let snap: Snapshot;
    try {
      snap = await (await remote()).pull();
    } catch {
      return null;
    }
    // A write made while the pull was on its way wins over what the pull brought.
    const pending = new Set((await outbox.entries("local")).map(([k]) => k));
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
    return { changed, settings: pending.has("settings/data") ? ("pending" as const) : snap.settings };
  };

  return {
    kv,
    flush,
    pull,
    saveSettings: (data) => enqueue({ ns: "settings", key: "data", value: data }),
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
