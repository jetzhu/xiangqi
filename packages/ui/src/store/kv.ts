// Key–value backends for the Store. Each namespace is a separate collection; the browser backend
// keeps the database and localStorage names the site has used since v0.1, so saved guest
// progress carries over.
import { createStore as idbStore, del, entries, get, set, type UseStore } from "idb-keyval";

export interface KV {
  get<T>(ns: Namespace, key: string): Promise<T | undefined>;
  set(ns: Namespace, key: string, value: unknown): Promise<void>;
  del(ns: Namespace, key: string): Promise<void>;
  entries<T>(ns: Namespace): Promise<[string, T][]>;
}

export type Namespace = "lessons" | "bots" | "puzzles" | "analyses" | "games" | "ratings" | "local";

/** IndexedDB database and object store per namespace ("local" lives in localStorage). */
const IDB: Record<Exclude<Namespace, "local">, [string, string]> = {
  lessons: ["xq-v1-lessons", "lessons"],
  bots: ["xq-v1-bots", "bots"],
  puzzles: ["xq-v1-puzzles", "puzzles"],
  analyses: ["xq-v1", "analyses"],
  games: ["xq-v1-games", "games"],
  ratings: ["xq-v1-ratings", "ratings"],
};

/**
 * The browser: IndexedDB, plus localStorage for the small "local" namespace. Reads fail soft
 * (undefined / empty) when storage is blocked, e.g. in some private windows; writes throw so a
 * caller that must report failure (saving an analysis) can.
 */
export function browserKV(): KV {
  const stores = new Map<string, UseStore>();
  const db = (ns: Exclude<Namespace, "local">) => {
    if (typeof indexedDB === "undefined") return undefined;
    if (!stores.has(ns)) stores.set(ns, idbStore(...IDB[ns]));
    return stores.get(ns);
  };
  return {
    async get<T>(ns: Namespace, key: string) {
      try {
        if (ns === "local") {
          const raw = localStorage.getItem(key);
          return raw === null ? undefined : (JSON.parse(raw) as T);
        }
        const s = db(ns);
        return s ? await get<T>(key, s) : undefined;
      } catch {
        return undefined;
      }
    },
    async set(ns, key, value) {
      if (ns === "local") return localStorage.setItem(key, JSON.stringify(value));
      const s = db(ns);
      if (!s) throw new Error("storage is not available in this browser");
      await set(key, value, s);
    },
    async del(ns, key) {
      if (ns === "local") return localStorage.removeItem(key);
      const s = db(ns);
      if (s) await del(key, s);
    },
    async entries<T>(ns: Namespace) {
      try {
        if (ns === "local") return [];
        const s = db(ns);
        return s ? await entries<string, T>(s) : [];
      } catch {
        return [];
      }
    },
  };
}

/** In memory, for tests (and as a fallback). Values are copied so callers can't share state. */
export function memoryKV(): KV {
  const data = new Map<string, Map<string, unknown>>();
  const ns = (n: string) => data.get(n) ?? data.set(n, new Map()).get(n)!;
  const copy = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
  return {
    get: async (n, k) => copy(ns(n).get(k)) as never,
    set: async (n, k, v) => void ns(n).set(k, copy(v)),
    del: async (n, k) => void ns(n).delete(k),
    entries: async (n) => [...ns(n).entries()].map(([k, v]) => [k, copy(v)]) as never,
  };
}
