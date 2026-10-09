"use client";
// Gives pages the right Store: this browser's guest store, or the signed-in account's (a local
// cache synced with Supabase, store/sync.ts). On sign-in it pulls the account, syncs settings
// and moves any guest progress in; on sign-out the account's cache is cleared, so a shared
// computer shows an empty guest state.

import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type Lang, type Settings, useSettings, useT } from "../settings.js";
import { StoreProvider, browserKV, createStore, defaultStore } from "../store/index.js";
import type { ImportSummary } from "../store/import.js";
import { idbKV } from "../store/kv.js";
import { type AccountSync, type SyncedSettings, accountSync } from "../store/sync.js";
import { type Account, useAccount } from "./session.js";

/** The account whose data this browser caches, so it can be cleared after signing out. */
const CACHE_USER = "xq:account-cache:v1";
/**
 * The account with a settings change not yet in the outbox. Written at once, because the change
 * often comes just before leaving the page (switching language), sooner than IndexedDB saves.
 */
const UNSENT = "xq:settings-unsent:v1";
/** The account's language, new to this browser at sign-in: the next page is shown in it. */
const FOLLOW_LANG = "xq:follow-lang:v1";
const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {}
  },
};
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

/** Settings that follow the account, the language included (the one the player chose). */
const syncedPart = (s: Settings): SyncedSettings => ({ ...s });
function fromAccount(data: SyncedSettings): Partial<Settings> {
  const known = Object.entries(data).filter(([k]) => k in DEFAULT_SETTINGS && (k !== "lang" || data.lang === "en" || data.lang === "zh"));
  return Object.fromEntries(known) as Partial<Settings>;
}

/**
 * Shows this page in the account's language when sign-in brought one new to this browser. Not
 * on the sign-in pages: they send the player back to where they came from, which then switches.
 */
function followLanguage(pageLang: Lang) {
  const want = storage.get(FOLLOW_LANG);
  if (want !== "en" && want !== "zh") return;
  if (want !== pageLang && /\/(login|signup|reset-password|auth)\//.test(location.pathname)) return;
  storage.set(FOLLOW_LANG, null);
  const there = want === pageLang ? null : inLanguage(want);
  if (there) location.replace(there);
}

/** This page's address in another language (/en/learn/ → /zh/learn/), or null if it has none. */
function inLanguage(lang: Lang): string | null {
  const url = new URL(location.href);
  const path = url.pathname.replace(/\/(en|zh)(?=\/|$)/, `/${lang}`);
  if (path === url.pathname) return null;
  url.pathname = path;
  return url.href;
}

const withLock = <T,>(name: string, fn: () => Promise<T>): Promise<T> =>
  typeof navigator !== "undefined" && navigator.locks ? (navigator.locks.request(name, fn) as Promise<T>) : fn();

const NoticeContext = createContext<{ welcome: ImportSummary | null; dismiss: () => void }>({ welcome: null, dismiss: () => {} });

export function AccountStoreProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { update, onChange, changes, saved } = useSettings();
  const pageLang = useSettings().settings.lang;
  const { state } = account;
  // While the session is still loading, the stored session already says whose cache to show.
  const userId = state.status === "signedIn" ? state.user.id : state.status === "loading" ? account.storedUserId() : null;
  const sync = useMemo(() => (userId ? syncFor(userId, account) : null), [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => sync?.stop(), [sync]);

  // A new Store object after a pull or import, so pages load the fresh data.
  const [rev, setRev] = useState(0);
  const store = useMemo(() => (sync ? createStore(sync.kv) : defaultStore()), [sync, rev]);

  const [welcome, setWelcome] = useState<ImportSummary | null>(null);
  const pageLangRef = useRef(pageLang);
  pageLangRef.current = pageLang;

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
      // A change that may not have reached the outbox (the last page closed first): send it again.
      if (storage.get(UNSENT) === userId) await sync.saveSettings(syncedPart(saved()));
      storage.set(UNSENT, null);
      const before = changes();
      const pulled = await sync.pull();
      if (!live || !pulled) return;
      // Settings: the account's win; a new account takes this browser's. A change made here
      // while the pull was on its way is newer than both.
      if (pulled.settings === null) void sync.saveSettings(syncedPart(saved()));
      else if (pulled.settings !== "pending" && changes() === before) {
        const previous = saved().lang;
        const theirs = fromAccount(pulled.settings);
        update(theirs, "account");
        // Saved before the language followed the account: add this browser's.
        if (!theirs.lang) void sync.saveSettings(syncedPart(saved()));
        // The account's language is new to this browser: show the page in it. (Once it's
        // known here, a link to the other language stays in that language.)
        else if (theirs.lang !== previous) {
          storage.set(FOLLOW_LANG, theirs.lang);
          followLanguage(pageLangRef.current);
        }
      }
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

  // A page reached after signing in (from the sign-in pages) switches to the account's language.
  useEffect(() => followLanguage(pageLang), [pageLang]);

  // Settings the player changes follow the account to other devices, from the moment the
  // stored session names the account (before the session is confirmed).
  useEffect(() => {
    if (!sync || !userId) return;
    let saving = 0;
    return onChange((s) => {
      storage.set(UNSENT, userId);
      saving++;
      void sync.saveSettings(syncedPart(s)).finally(() => {
        if (--saving === 0) storage.set(UNSENT, null);
      });
    });
  }, [sync, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

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
