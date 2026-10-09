"use client";
// Gives pages the right Store: this browser's guest store, or the signed-in account's (a local
// cache synced with Supabase, store/sync.ts). On sign-in it pulls the account, syncs settings
// and moves any guest progress in; on sign-out the account's cache is cleared, so a shared
// computer shows an empty guest state.

import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type Settings, useSettings, useT } from "../settings.js";
import { StoreProvider, browserKV, createStore, defaultStore } from "../store/index.js";
import type { ImportSummary } from "../store/import.js";
import { idbKV } from "../store/kv.js";
import { type AccountSync, type SyncedSettings, accountSync } from "../store/sync.js";
import { type Account, useAccount } from "./session.js";

/** The account whose data this browser caches, so it can be cleared after signing out. */
const CACHE_USER = "xq:account-cache:v1";
const dbNames = (uid: string) => ({ cache: `xq-account-${uid}`, outbox: `xq-account-${uid}-outbox`, device: `xq-account-${uid}-device` });

function syncFor(uid: string, account: Account): AccountSync {
  const names = dbNames(uid);
  return accountSync({
    cache: idbKV(names.cache),
    outbox: idbKV(names.outbox),
    device: idbKV(names.device),
    // Loaded with the Supabase library, only once someone signs in.
    remote: async () => (await import("./remote.js")).supabaseRemote(await account.client(), uid),
  });
}

const clearCache = (uid: string) => Promise.all([idbKV(dbNames(uid).cache).clear(), idbKV(dbNames(uid).outbox).clear()]);

/** Settings that follow the account: all but the language, which each page's address sets. */
function syncedPart(s: Settings): SyncedSettings {
  const { lang: _lang, ...rest } = s;
  return rest;
}
function fromAccount(data: SyncedSettings): Partial<Settings> {
  return Object.fromEntries(Object.entries(data).filter(([k]) => k in DEFAULT_SETTINGS && k !== "lang")) as Partial<Settings>;
}

const withLock = <T,>(name: string, fn: () => Promise<T>): Promise<T> =>
  typeof navigator !== "undefined" && navigator.locks ? (navigator.locks.request(name, fn) as Promise<T>) : fn();

const NoticeContext = createContext<{ welcome: ImportSummary | null; dismiss: () => void }>({ welcome: null, dismiss: () => {} });

export function AccountStoreProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { settings, update, onChange, changes } = useSettings();
  const { state } = account;
  // While the session is still loading, the stored session already says whose cache to show.
  const userId = state.status === "signedIn" ? state.user.id : state.status === "loading" ? account.storedUserId() : null;
  const sync = useMemo(() => (userId ? syncFor(userId, account) : null), [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => sync?.stop(), [sync]);

  // A new Store object after a pull or import, so pages load the fresh data.
  const [rev, setRev] = useState(0);
  const store = useMemo(() => (sync ? createStore(sync.kv) : defaultStore()), [sync, rev]);

  const [welcome, setWelcome] = useState<ImportSummary | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const signedIn = state.status === "signedIn";
  useEffect(() => {
    if (!signedIn || !sync || !userId) return;
    let live = true;
    try {
      const previous = localStorage.getItem(CACHE_USER);
      if (previous && previous !== userId) void clearCache(previous);
      localStorage.setItem(CACHE_USER, userId);
    } catch {}

    const run = async () => {
      const before = changes();
      const pulled = await sync.pull();
      if (!live || !pulled) return;
      // Settings: the account's win; a new account takes this browser's. A change made here
      // while the pull was on its way is newer than both.
      if (pulled.settings === null) void sync.saveSettings(syncedPart(settingsRef.current));
      else if (pulled.settings !== "pending" && changes() === before) update(fromAccount(pulled.settings), "account");
      const guest = browserKV();
      const { hasGuestData, importGuest } = await import("../store/import.js");
      const summary = await withLock("xq-guest-import", async () => ((await hasGuestData(guest)) ? importGuest(guest, sync.kv) : null));
      if (!live) return;
      if (summary) {
        setWelcome(summary);
        void sync.flush();
      }
      if (pulled.changed || summary) setRev((r) => r + 1);
    };
    void run();
    const online = () => void run();
    window.addEventListener("online", online);
    const unhook = account.beforeSignOut(() => sync.flush());
    return () => {
      live = false;
      window.removeEventListener("online", online);
      unhook();
    };
  }, [signedIn, sync]); // eslint-disable-line react-hooks/exhaustive-deps

  // Settings the player changes follow the account to other devices, from the moment the
  // stored session names the account (before the session is confirmed).
  useEffect(() => (sync ? onChange((s) => void sync.saveSettings(syncedPart(s))) : undefined), [sync, onChange]);

  // Signed out (here, in another tab, or everywhere): forget the account's cached data. A
  // session still stored means sign-in just couldn't be checked (offline), so keep it.
  useEffect(() => {
    if (state.status !== "guest") return;
    setWelcome(null);
    try {
      const uid = localStorage.getItem(CACHE_USER);
      if (!uid || account.storedUserId()) return;
      localStorage.removeItem(CACHE_USER);
      void clearCache(uid).then(() => setRev((r) => r + 1));
    } catch {}
  }, [state.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const notice = useMemo(() => ({ welcome, dismiss: () => setWelcome(null) }), [welcome]);
  return (
    <StoreProvider store={store}>
      <NoticeContext.Provider value={notice}>{children}</NoticeContext.Provider>
    </StoreProvider>
  );
}

const count = (n: number, en: [string, string], zh: string, lang: "en" | "zh") => (lang === "zh" ? `${n} ${zh}` : `${n} ${n === 1 ? en[0] : en[1]}`);

/** "Your progress is saved": shown once, after guest progress moved into the account. */
export function SyncNotice() {
  const { welcome, dismiss } = useContext(NoticeContext);
  const { tt, lang } = useT();
  if (!welcome) return null;
  const join = (parts: (string | 0)[]) => (parts.filter(Boolean) as string[]).join(lang === "zh" ? "、" : ", ");
  const saved = join([
    welcome.lessons && count(welcome.lessons, ["lesson", "lessons"], "节课", lang),
    welcome.analyses && count(welcome.analyses, ["analysis", "analyses"], "个分析", lang),
  ]);
  // Puzzles and bot games can only join the account once the server checks them (M12).
  const kept = join([
    welcome.puzzles &&
      (lang === "zh" ? `${welcome.puzzles} 道题及解题等级分` : `${count(welcome.puzzles, ["puzzle", "puzzles"], "", lang)} with your puzzle rating`),
    welcome.games && count(welcome.games, ["game", "games"], "盘对局", lang),
  ]);
  return (
    <div className="sync-notice" role="status">
      <p>
        {saved
          ? tt(`Your progress from this browser is now saved to your account: ${saved}.`, `本浏览器中的进度已保存到你的账号：${saved}。`)
          : tt("Your progress from this browser is now saved to your account.", "本浏览器中的进度已保存到你的账号。")}
        {kept &&
          ` ${tt(
            `Kept in this browser for now, until a coming update moves them to your account: ${kept}.`,
            `以下内容暂时只保存在本浏览器，后续更新会将其移入你的账号：${kept}。`,
          )}`}
      </p>
      <button type="button" onClick={dismiss} aria-label={tt("Dismiss", "关闭")}>
        ×
      </button>
    </div>
  );
}
