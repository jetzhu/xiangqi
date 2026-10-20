"use client";
// Quick pairing (M17): the six tiles with how many players are seeking on each, then the search.
// The browser asks find_match every few seconds, which pairs within a rating window that widens
// while the player waits; the nearest players outside it can be invited ("Play anyway"), and
// after 30 s the player may widen to anyone, switch tile, or play a bot while waiting.
import { BOTS } from "@xq/content";
import { SPEEDS, TILES, type TimeControl, formatTimeControl } from "@xq/online";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { PRESETS } from "../bots/BotPicker.js";
import { useAccount } from "../account/session.js";
import { useNav } from "../nav.js";
import { type Settings, useSettings, useT } from "../settings.js";
import { type Seeking, type Sportsmanship, answerInvite, cancelSeek, findMatch, inviteSeeker, seek, seekCounts, widenSeek } from "./api.js";
import { SPEED_NAME } from "./PlayerPage.js";

// The bot game loads only when asked for, so the Play online page stays light.
const BotGame = lazy(() => import("../bots/BotGame.js").then((m) => ({ default: m.BotGame })));

const POLL_MS = 2_500;
/** After this long the page offers to widen to anyone, switch tile, or play a bot. */
const OFFER_AFTER_S = 30;
/** With a bot game on, the move to the real game waits this long so the player sees why. */
const LEAVE_BOT_MS = 3_000;

const key = (tc: TimeControl) => `${tc.base}+${tc.inc}`;
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");

/** `busy`: a game is in progress in this browser, so no new search starts (one already running carries on). */
export function QuickPair({ level, sport, onSport, busy }: { level: number; sport: Sportsmanship | null; onSport: () => void; busy: boolean }) {
  const { tt, t, lang } = useT();
  const nav = useNav();
  const account = useAccount();
  const { settings } = useSettings();
  const [tc, setTc] = useState<TimeControl | null>(null);
  const [state, setState] = useState<Seeking | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [bot, setBot] = useState<number | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const searching = useRef(false);
  // The latest account, for the clean-up when the page closes (the object changes as the session does).
  const accountRef = useRef(account);
  accountRef.current = account;

  const go = useCallback((game: string) => {
    searching.current = false;
    setFound(game);
  }, []);
  useEffect(() => {
    if (!found) return;
    const timer = setTimeout(() => location.assign(nav.href(`/game?id=${found}`)), bot === null ? 0 : LEAVE_BOT_MS);
    return () => clearTimeout(timer);
  }, [found, bot, nav]);

  // The tiles' counts while not searching (the search returns them itself).
  useEffect(() => {
    if (tc) return;
    const load = () => void account.client().then(seekCounts).then(setCounts, () => {});
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [tc, account]);

  // The search: ask every few seconds until matched.
  useEffect(() => {
    if (!tc) return;
    let stop = false;
    const poll = async () => {
      if (stop || !searching.current) return;
      try {
        const account = accountRef.current;
        const m = await findMatch(await account.client());
        if (stop) return;
        if (m.status === "matched") return go(m.game);
        if (m.status === "idle") {
          // The seek was cleared (the tab slept for a minute): start again.
          await seek(await account.client(), tc, filters(), settings.relayOnly);
          return;
        }
        setState(m);
        setCounts(m.counts);
      } catch {
        // A missed poll is harmless; the next one tries again.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tc, go]);

  // Leaving the page stops the search (a seek nobody asks about lapses after 10 s anyway).
  useEffect(
    () => () => {
      if (searching.current) void accountRef.current.client().then(cancelSeek).catch(() => {});
    },
    [],
  );

  const filters = () => ({
    range: settings.opponentRange === "any" ? null : settings.opponentRange,
    established: settings.opponentEstablished,
    account_age: settings.opponentAccountAge,
    completion: settings.opponentCompletion,
    checked: settings.opponentChecked,
  });

  const start = async (next: TimeControl) => {
    setError(null);
    setNote(null);
    try {
      await seek(await account.client(), next, filters(), settings.relayOnly);
      searching.current = true;
      setState(null);
      setTc(next);
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      if (/sportsmanship/.test(m)) onSport();
      else setError(/not ready/.test(m) ? tt("Finish the steps above first.", "请先完成上面的步骤。") : tt("Couldn't start the search. Try again.", "无法开始寻找对手，请重试。"));
    }
  };

  const cancel = async () => {
    searching.current = false;
    setTc(null);
    setState(null);
    setBot(null);
    await cancelSeek(await account.client()).catch(() => {});
  };

  const invite = async (username: string) => {
    const ok = await inviteSeeker(await account.client(), username).catch(() => false);
    if (!ok) setNote(tt(`${username} is no longer seeking.`, `${username} 已不在寻找对手。`));
  };

  const answer = async (id: number, accept: boolean) => {
    setState((s) => (s ? { ...s, invite: null } : s));
    const game = await answerInvite(await account.client(), id, accept).catch(() => null);
    if (game) go(game);
    else if (accept) setNote(tt("No longer available, still searching…", "对方已不在，继续寻找…"));
  };

  if (found && bot === null) return <p className="waiting" role="status">{tt("Opponent found…", "已找到对手…")}</p>;

  const wait = sport?.wait_until ? new Date(sport.wait_until) : null;
  if (!tc) {
    return (
      <section className="quick-pair" aria-labelledby="h-quick">
        <h2 id="h-quick">{tt("Quick pairing", "快速匹配")}</h2>
        <p className="muted small">{tt("Rated games with a player of about your level. Your opponent filters are in Settings → Online play.", "与水平相近的棋手下计分对局。对手筛选在“设置 → 在线对弈”中。")}</p>
        {wait && wait > new Date() ? (
          <p className="form-error">
            {tt(
              `After leaving or stalling games, you can look for a new game from ${wait.toLocaleTimeString(lang === "zh" ? "zh-CN" : "en", { hour: "numeric", minute: "2-digit" })}.`,
              `由于离开或拖延对局，你在 ${wait.toLocaleTimeString("zh-CN", { hour: "numeric", minute: "2-digit" })} 之后才能再次匹配。`,
            )}
          </p>
        ) : null}
        <div className="tiles">
          {SPEEDS.map((s) => (
            <div key={s} className="tile-group">
              <span className="muted small">{t(SPEED_NAME[s])}</span>
              {TILES[s].map((x, i) => (
                <button key={key(x)} type="button" className={i === 0 ? "tile main" : "tile"} disabled={busy || !!sport?.warning || (!!wait && wait > new Date())} onClick={() => void start(x)}>
                  {formatTimeControl(x)}
                  <span className="tile-count">{tt(`${counts[key(x)] ?? 0} seeking`, `${counts[key(x)] ?? 0} 人在找`)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        {error && <p className="form-error">{error}</p>}
      </section>
    );
  }

  const others = SPEEDS.flatMap((s) => TILES[s]).filter((x) => key(x) !== key(tc) && (counts[key(x)] ?? 0) > 0);
  const later = (state?.waited ?? 0) >= OFFER_AFTER_S;
  const minutes = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
  return (
    <section className="quick-pair searching" aria-labelledby="h-quick">
      <h2 id="h-quick">
        {found ? tt("Opponent found!", "已找到对手！") : tt(`Looking for an opponent: ${formatTimeControl(tc)}`, `正在寻找对手：${formatTimeControl(tc)}`)}
      </h2>
      {found ? (
        <p role="status">{tt("Going to your game. The bot game ends here, unrated.", "即将进入对局。人机对局到此结束，不计分。")}</p>
      ) : (
        <>
          <p className="waiting" role="status">
            <span className="dot" aria-hidden />{" "}
            {state
              ? state.window === null
                ? tt(`Any rating · ${minutes(state.waited)}`, `不限等级分 · ${minutes(state.waited)}`)
                : tt(`Within ±${state.window} of your rating · ${minutes(state.waited)}`, `等级分相差 ±${state.window} 以内 · ${minutes(state.waited)}`)
              : "…"}
          </p>
          {state?.invite && (
            <div className="invite" role="alert">
              <p>
                {tt(
                  `A player rated ${state.invite.rating} (${signed(state.invite.diff)}) is ready to play you.`,
                  `一位等级分 ${state.invite.rating}（${signed(state.invite.diff)}）的棋手准备与你对弈。`,
                )}
              </p>
              <button type="button" className="primary" onClick={() => void answer(state.invite!.id, true)}>
                {tt("Accept", "接受")}
              </button>{" "}
              <button type="button" onClick={() => void answer(state.invite!.id, false)}>
                {tt("Decline", "拒绝")}
              </button>
            </div>
          )}
          {state && state.nearest.length > 0 && (
            <div className="nearest">
              <p className="muted small">{tt("Nobody in range yet. Closest players also seeking:", "范围内暂无对手。正在寻找的最接近棋手：")}</p>
              <ul>
                {state.nearest.map((n) => (
                  <li key={n.username}>
                    {n.username}, {n.rating} ({signed(n.diff)}), {tt(`waiting ${n.waited} s`, `已等 ${n.waited} 秒`)}{" "}
                    {n.invited ? (
                      <span className="muted">{tt("Invited…", "已邀请…")}</span>
                    ) : (
                      <button type="button" onClick={() => void invite(n.username)}>
                        {tt("Play anyway", "仍然对弈")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state?.excluded && Object.keys(state.excluded).length > 0 && (
            <p className="excluded small" role="status">
              {tt("Your filters leave out players searching here:", "你的筛选条件排除了正在这里寻找对手的棋手：")}{" "}
              {(Object.entries(state.excluded) as [keyof NonNullable<Seeking["excluded"]>, number][])
                .map(([k, n]) => `${filterName(k, settings, tt)}: ${n}`)
                .join(tt(", ", "，"))}
              .{" "}
              <a href={nav.href("/settings?tab=online")}>{tt("Change filters", "修改筛选")}</a>
            </p>
          )}
          {note && <p className="muted">{note}</p>}
          <p className="buttons">
            <button type="button" onClick={() => void cancel()}>
              {tt("Cancel", "取消")}
            </button>
            {later && state && !state.anyone && (
              <button type="button" onClick={() => void account.client().then(widenSeek).catch(() => {})}>
                {tt("Widen to anyone", "放宽到任何人")}
              </button>
            )}
            {later &&
              others.map((x) => (
                <button key={key(x)} type="button" onClick={() => void start(x)}>
                  {tt(`${counts[key(x)]} waiting in ${formatTimeControl(x)}`, `${formatTimeControl(x)} 有 ${counts[key(x)]} 人在等`)}
                </button>
              ))}
            {later && bot === null && (
              <button type="button" onClick={() => setBot(1)}>
                {tt("Play a bot while waiting", "等待时与机器人对弈")}
              </button>
            )}
          </p>
        </>
      )}
      {bot !== null && (
        <Suspense fallback={<p className="muted">…</p>}>
          <BotGame
            key={bot}
            bot={botFor(level)}
            playerColor="red"
            settings={{ color: "red", time: "none", assists: PRESETS.fair, rated: false }}
            lang={lang}
            onExit={() => setBot(null)}
            onRematch={() => setBot((b) => (b ?? 0) + 1)}
          />
        </Suspense>
      )}
    </section>
  );
}

/** The strongest bot at or below the player's level, for a casual game while waiting. */
function botFor(level: number) {
  const ladder = [...BOTS].sort((a, b) => a.ratingLabel - b.ratingLabel);
  return ladder.filter((b) => b.ratingLabel <= level).pop() ?? ladder[0]!;
}

/** A filter's name with the player's setting, for the "your filters leave out…" line. */
function filterName(k: "completion" | "account_age" | "established" | "checked", s: Settings, tt: (en: string, zh: string) => string) {
  switch (k) {
    case "completion":
      return tt(`completion rate ${s.opponentCompletion} %+`, `完成率 ${s.opponentCompletion}% 以上`);
    case "account_age":
      return tt(`accounts ${s.opponentAccountAge}+ days old`, `注册 ${s.opponentAccountAge} 天以上`);
    case "established":
      return tt("established players only", "只匹配等级分已稳定的棋手");
    case "checked":
      return tt("10+ fair-play checked games", "10 盘以上公平性检查");
  }
}
