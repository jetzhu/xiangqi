"use client";
// Play a friend (M16): choose the time, colour and rated or casual, then share the link (or
// read out the code). The page waits for the friend to accept and then opens the game. Casual
// games need only a verified email and the birth month; rated ones also the bot games (D9).
import { TILES, type TimeControl, formatTimeControl, speedOf } from "@xq/online";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "../account/session.js";
import { useNav } from "../nav.js";
import { useSettings, useT } from "../settings.js";
import { type ChallengeColor, type Eligibility, cancelChallenge, challengeInfo, createChallenge, onlineEligibility } from "./api.js";
import { SPEED_NAME } from "./PlayerPage.js";

const BASES = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60];
const INCS = [0, 1, 2, 3, 5, 10, 15, 20, 30];

export function FriendPage() {
  const { tt, t } = useT();
  const nav = useNav();
  const account = useAccount();
  const { settings } = useSettings();
  const signedIn = account.state.status === "signedIn";
  const [check, setCheck] = useState<Eligibility | null | "error">(null);
  const [tc, setTc] = useState<TimeControl>(TILES.blitz[0]!);
  const [color, setColor] = useState<ChallengeColor>("random");
  const [rated, setRated] = useState(true);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (signedIn)
      void account
        .client()
        .then(onlineEligibility)
        .then((c) => {
          setCheck(c);
          if (c && !c.eligible) setRated(false);
        }, () => setCheck("error"));
  }, [signedIn, account]);

  // Waiting for the friend: look every 2 s; open the game once they've accepted.
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => {
      void account
        .client()
        .then((sb) => challengeInfo(sb, code))
        .then((c) => {
          if (c?.game) location.assign(nav.href(`/game?id=${c.game}`));
        })
        .catch(() => {});
    }, 2_000);
    return () => clearInterval(timer);
  }, [code, account, nav]);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setCode(await createChallenge(await account.client(), { ...tc, color, rated, relay: settings.relayOnly }));
    } catch (e) {
      setError(e instanceof Error && /not ready/.test(e.message) ? tt("Finish the steps on the Play online page first.", "请先完成“在线对弈”页面上的准备步骤。") : tt("Couldn't create the challenge. Try again.", "无法创建挑战，请重试。"));
    } finally {
      setBusy(false);
    }
  }, [account, tc, color, rated, settings.relayOnly, tt]);

  const cancel = async () => {
    if (code) await cancelChallenge(await account.client(), code).catch(() => {});
    setCode(null);
  };

  if (account.state.status === "loading") return <p className="muted" style={{ padding: 24 }}>…</p>;
  if (!signedIn) {
    return (
      <div className="online-page">
        <h1>{tt("Play a friend", "与好友对弈")}</h1>
        <p>
          {tt("Playing online needs a free account.", "在线对弈需要免费账号。")} <a href={nav.href("/signup")}>{tt("Sign up", "注册")}</a> ·{" "}
          <a href={`${nav.href("/login")}?next=/friend`}>{tt("Log in", "登录")}</a>
        </p>
      </div>
    );
  }
  if (check === "error") return <p className="form-error" style={{ padding: 24 }}>{tt("Couldn't load your account. Check your connection and try again.", "无法载入账号，请检查网络后重试。")}</p>;
  if (!check) return <p className="muted" style={{ padding: 24 }}>…</p>;
  if (!check.casual_ok) {
    return (
      <div className="online-page">
        <h1>{tt("Play a friend", "与好友对弈")}</h1>
        <p>
          {tt("A verified email and your birth month first.", "请先验证邮箱并填写出生年月。")}{" "}
          <a href={nav.href("/online")}>{tt("See what's left", "查看还差什么")}</a>
        </p>
      </div>
    );
  }

  const link = code ? `${location.origin}${nav.href(`/challenge?c=${code}`)}` : "";
  const speed = speedOf(tc);

  if (code) {
    return (
      <div className="online-page">
        <h1>{tt("Waiting for your friend", "等待好友加入")}</h1>
        <p className="sub">{tt("Send them this link, or read out the code. The game starts as soon as they accept.", "把链接发给好友，或念出挑战码。好友接受后对局立即开始。")}</p>
        <p className="challenge-code" aria-label={tt("Challenge code", "挑战码")}>
          {code}
        </p>
        <div className="share-link">
          <input readOnly value={link} aria-label={tt("Challenge link", "挑战链接")} onFocus={(e) => e.currentTarget.select()} />
          <button
            type="button"
            className="primary"
            onClick={() => {
              void navigator.clipboard?.writeText(link).then(() => setCopied(true));
            }}
          >
            {copied ? tt("Copied", "已复制") : tt("Copy link", "复制链接")}
          </button>
        </div>
        <p className="muted">
          {formatTimeControl(tc)} · {t(SPEED_NAME[speed])} · {rated ? tt("Rated", "计分") : tt("Casual", "休闲")} ·{" "}
          {color === "red" ? tt("You play Red", "你执红") : color === "black" ? tt("You play Black", "你执黑") : tt("Colours drawn at random", "随机分配红黑")}
        </p>
        <p className="waiting" role="status">
          <span className="dot" aria-hidden /> {tt("Waiting…", "等待中…")}
        </p>
        <button type="button" onClick={() => void cancel()}>
          {tt("Cancel challenge", "取消挑战")}
        </button>
        <p className="muted small">{tt("The link works for 24 hours, for one friend.", "链接 24 小时内有效，仅限一位好友使用。")}</p>
      </div>
    );
  }

  const tile = (x: TimeControl) => (
    <button key={formatTimeControl(x)} type="button" className={x.base === tc.base && x.inc === tc.inc ? "tile selected" : "tile"} aria-pressed={x.base === tc.base && x.inc === tc.inc} onClick={() => setTc(x)}>
      {formatTimeControl(x)}
    </button>
  );

  return (
    <div className="online-page friend-page">
      <h1>{tt("Play a friend", "与好友对弈")}</h1>
      <p className="sub">{tt("Make a link, send it to a friend, and the game starts when they open it.", "生成链接发给好友，好友打开即可开始对局。")}</p>

      <h2>{tt("Time", "用时")}</h2>
      <div className="tiles">
        {(["lightning", "blitz", "rapid"] as const).map((s) => (
          <div key={s} className="tile-group">
            <span className="muted small">{t(SPEED_NAME[s])}</span>
            {TILES[s].map(tile)}
          </div>
        ))}
      </div>
      <div className="options">
        <label>
          {tt("Minutes each", "每方分钟")}
          <select value={tc.base / 60} onChange={(e) => setTc({ ...tc, base: Number(e.target.value) * 60 })}>
            {BASES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          {tt("Seconds added per move", "每步加秒")}
          <select value={tc.inc} onChange={(e) => setTc({ ...tc, inc: Number(e.target.value) })}>
            {INCS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small">
        {formatTimeControl(tc)}: {t(SPEED_NAME[speed])}. {tt(`${tc.base / 60} min each, plus ${tc.inc} s after every move.`, `每方 ${tc.base / 60} 分钟，每走一步加 ${tc.inc} 秒。`)}
      </p>

      <h2>{tt("Your colour", "你的执子")}</h2>
      <div className="segmented" role="radiogroup" aria-label={tt("Your colour", "你的执子")}>
        {(
          [
            ["red", tt("Red", "红方")],
            ["random", tt("Random", "随机")],
            ["black", tt("Black", "黑方")],
          ] as const
        ).map(([c, label]) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} className={color === c ? "selected" : ""} onClick={() => setColor(c)}>
            {label}
          </button>
        ))}
      </div>

      <h2>{tt("Rated or casual", "计分或休闲")}</h2>
      <div className="segmented" role="radiogroup" aria-label={tt("Rated or casual", "计分或休闲")}>
        <button type="button" role="radio" aria-checked={rated} className={rated ? "selected" : ""} disabled={!check.eligible} onClick={() => setRated(true)}>
          {tt("Rated", "计分")}
        </button>
        <button type="button" role="radio" aria-checked={!rated} className={!rated ? "selected" : ""} onClick={() => setRated(false)}>
          {tt("Casual", "休闲")}
        </button>
      </div>
      <p className="muted small">
        {!check.eligible && (
          <>
            {tt("Rated games need the bot games first.", "计分对局需要先完成人机对局要求。")} <a href={nav.href("/online")}>{tt("See what's left", "查看还差什么")}</a>{" "}
          </>
        )}
        {rated
          ? tt(`Changes both players' ${t(SPEED_NAME[speed])} ratings. No takebacks.`, `影响双方的${t(SPEED_NAME[speed])}等级分。不能悔棋。`)
          : tt("No rating change. Takebacks allowed if your friend agrees.", "不影响等级分。对方同意即可悔棋。")}
      </p>

      {error && <p className="form-error">{error}</p>}
      <button type="button" className="primary big" disabled={busy} onClick={() => void create()}>
        {tt("Create challenge link", "生成挑战链接")}
      </button>
    </div>
  );
}
