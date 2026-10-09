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

interface Notices {
  welcome: ImportSummary | null;
  dismiss: () => void;
  /** The skill question is open: the account has no ratings yet. */
  askSkill: boolean;
  /** Answers it (400, 800, 1200 or 1600); resolves false if that couldn't be saved. */
  answerSkill: (rating: number) => Promise<boolean>;
  /** Signing in just cancelled a deletion the player had asked for. */
  deletionCancelled: boolean;
}
const NoticeContext = createContext<Notices>({ welcome: null, dismiss: () => {}, askSkill: false, answerSkill: async () => false, deletionCancelled: false });

export function AccountStoreProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { update, onChange, changes, saved, knowsLang } = useSettings();
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
  const [askSkill, setAskSkill] = useState(false);
  const [deletionCancelled, setDeletionCancelled] = useState(false);
  const pageLangRef = useRef(pageLang);
  pageLangRef.current = pageLang;

  // (Before the sign-in effect, so a change it must not overwrite is already marked unsent.)
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
      // Signed in during the 10 days: the deletion is off (as on chess.com).
      if (pulled.deletionPending) {
        const { data } = await (await account.client()).rpc("cancel_account_deletion");
        if (live && data === true) {
          setDeletionCancelled(true);
          try {
            sessionStorage.removeItem("xq:deletion-scheduled");
          } catch {}
        }
      }
      // Settings: the account's win; a new account takes this browser's. A change made here
      // while the pull was on its way is newer than both.
      if (pulled.settings === null) void sync.saveSettings(syncedPart(saved()));
      else if (pulled.settings !== "pending" && changes() === before) {
        const previous = saved().lang;
        const theirs = fromAccount(pulled.settings);
        // The language last used here is newer than the account's; a browser with none of its
        // own takes the account's.
        const ours = knowsLang() && theirs.lang !== previous;
        if (ours) theirs.lang = previous;
        update(theirs, "account");
        // Saved before the language followed the account, or changed here: send this browser's.
        if (!theirs.lang || ours) void sync.saveSettings(syncedPart(saved()));
        // The account's language is new to this browser: show the page in it.
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
      setAskSkill(pulled.newPlayer);
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


  // Signed out (here, in another tab, or everywhere): forget the account's cached data. A
  // session still stored means sign-in just couldn't be checked (offline), so keep it.
  useEffect(() => {
    if (state.status !== "guest") return;
    setWelcome(null);
    setAskSkill(false);
    try {
      const uid = localStorage.getItem(CACHE_USER);
      if (!uid || account.storedUserId()) return;
      localStorage.removeItem(CACHE_USER);
      void clearCache(uid).then(() => setRev((r) => r + 1));
    } catch {}
  }, [state.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const notice = useMemo<Notices>(
    () => ({
      welcome,
      dismiss: () => {
        setWelcome(null);
        setDeletionCancelled(false);
      },
      deletionCancelled,
      askSkill,
      async answerSkill(rating) {
        if (!sync) return false;
        try {
          await sync.startingRating(rating);
        } catch {
          return false; // offline: asked again later
        }
        setAskSkill(false);
        setRev((r) => r + 1);
        return true;
      },
    }),
    [welcome, askSkill, sync, deletionCancelled],
  );
  return (
    <StoreProvider store={store}>
      <NoticeContext.Provider value={notice}>{children}</NoticeContext.Provider>
    </StoreProvider>
  );
}

const count = (n: number, en: [string, string], zh: string, lang: "en" | "zh") => (lang === "zh" ? `${n} ${zh}` : `${n} ${n === 1 ? en[0] : en[1]}`);

/** "Your progress is saved": shown once, after guest progress moved into the account. */
export function SyncNotice() {
  const { welcome, dismiss, deletionCancelled } = useContext(NoticeContext);
  const { tt, lang } = useT();
  if (deletionCancelled)
    return (
      <div className="sync-notice" role="status">
        <p>{tt("Welcome back. Your account will not be deleted: signing in cancelled it.", "欢迎回来。你的账号不会被删除：登录已取消删除申请。")}</p>
        <button type="button" onClick={dismiss} aria-label={tt("Dismiss", "关闭")}>
          ×
        </button>
      </div>
    );
  if (!welcome) return null;
  const parts = [
    welcome.lessons && count(welcome.lessons, ["lesson", "lessons"], "节课", lang),
    welcome.puzzles && count(welcome.puzzles, ["puzzle", "puzzles"], "道题", lang),
    welcome.games && count(welcome.games, ["game", "games"], "盘对局", lang),
    welcome.analyses && count(welcome.analyses, ["analysis", "analyses"], "个分析", lang),
  ].filter(Boolean) as string[];
  const list = parts.join(lang === "zh" ? "、" : ", ");
  return (
    <div className="sync-notice" role="status">
      <p>
        {list
          ? tt(`Your progress from this browser is now saved to your account: ${list}.`, `本浏览器中的进度已保存到你的账号：${list}。`)
          : tt("Your progress from this browser is now saved to your account.", "本浏览器中的进度已保存到你的账号。")}
      </p>
      <button type="button" onClick={dismiss} aria-label={tt("Dismiss", "关闭")}>
        ×
      </button>
    </div>
  );
}

const LEVELS: { rating: number; en: string; zh: string }[] = [
  { rating: 400, en: "New to Xiangqi", zh: "刚接触象棋" },
  { rating: 800, en: "Beginner", zh: "初学" },
  { rating: 1200, en: "Intermediate", zh: "中级" },
  { rating: 1600, en: "Advanced", zh: "高级" },
];

/**
 * "How well do you know Xiangqi?": asked once, for an account with no ratings yet, to set the
 * starting bot and puzzle rating (as chess.com does). Skipping or closing it means 800.
 */
export function SkillQuestion() {
  const { askSkill, answerSkill } = useContext(NoticeContext);
  const { tt } = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!askSkill) return null;
  const answer = async (rating: number) => {
    setBusy(true);
    setFailed(!(await answerSkill(rating)));
    setBusy(false);
  };
  return (
    <div className="skill-question" role="region" aria-label={tt("Starting rating", "初始等级分")}>
      <p>{tt("How well do you know Xiangqi? Your answer sets your starting rating for bot games and puzzles.", "你的象棋水平如何？你的回答将决定人机对局和解题的初始等级分。")}</p>
      <div className="skill-options">
        {LEVELS.map((l) => (
          <button key={l.rating} type="button" disabled={busy} onClick={() => void answer(l.rating)}>
            {tt(l.en, l.zh)} <span className="muted">{l.rating}</span>
          </button>
        ))}
        <button type="button" className="link" disabled={busy} onClick={() => void answer(800)}>
          {tt("Skip", "跳过")}
        </button>
      </div>
      {failed && <p className="form-error">{tt("Couldn't save that. Check your connection and try again.", "保存失败，请检查网络后重试。")}</p>}
      <button type="button" disabled={busy} onClick={() => void answer(800)} aria-label={tt("Skip", "跳过")}>
        ×
      </button>
    </div>
  );
}
