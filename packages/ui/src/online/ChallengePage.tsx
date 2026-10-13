"use client";
// A challenge link, /challenge?c=CODE (M16): who it's from and on what terms, and Accept.
import { formatTimeControl, speedOf } from "@xq/online";
import { useEffect, useState } from "react";
import { useAccount } from "../account/session.js";
import { useNav } from "../nav.js";
import { useSettings, useT } from "../settings.js";
import { type ChallengeInfo, type Eligibility, acceptChallenge, challengeInfo, onlineEligibility } from "./api.js";
import { SPEED_NAME } from "./PlayerPage.js";

export function ChallengePage() {
  const { tt, t } = useT();
  const nav = useNav();
  const account = useAccount();
  const { settings } = useSettings();
  const code = (nav.params().get("c") ?? "").toUpperCase();
  const [info, setInfo] = useState<ChallengeInfo | null | "loading" | "error">("loading");
  const [check, setCheck] = useState<Eligibility | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = account.state.status === "signedIn";

  useEffect(() => {
    if (account.state.status === "loading") return;
    if (!code) return setInfo(null);
    void account
      .client()
      .then((sb) => challengeInfo(sb, code))
      .then(setInfo, () => setInfo("error"));
    if (signedIn) void account.client().then(onlineEligibility).then(setCheck, () => {});
  }, [code, account, signedIn]);

  // My own challenge: wait here as on the Play a friend page.
  useEffect(() => {
    if (!info || typeof info !== "object" || !info.mine || info.taken) return;
    const timer = setInterval(() => {
      void account
        .client()
        .then((sb) => challengeInfo(sb, code))
        .then((c) => c?.game && location.assign(nav.href(`/game?id=${c.game}`)))
        .catch(() => {});
    }, 2_000);
    return () => clearInterval(timer);
  }, [info, code, account, nav]);

  if (info === "loading" || account.state.status === "loading") return <p className="muted" style={{ padding: 24 }}>…</p>;
  if (info === "error") return <p className="form-error" style={{ padding: 24 }}>{tt("Couldn't load the challenge. Check your connection and try again.", "无法载入挑战，请检查网络后重试。")}</p>;
  if (!info) {
    return (
      <div className="online-page">
        <h1>{tt("Challenge not found", "找不到该挑战")}</h1>
        <p className="muted">{tt("Check the code, or ask your friend for a new link.", "请核对挑战码，或请好友重新发送链接。")}</p>
      </div>
    );
  }

  const speed = speedOf(info);
  const yourColor = info.color === "random" ? tt("random colours", "随机执子") : info.color === "red" ? tt("you play Black", "你执黑") : tt("you play Red", "你执红");
  const terms = (
    <p className="challenge-terms">
      <strong>{formatTimeControl(info)}</strong> · {t(SPEED_NAME[speed])} · {info.rated ? tt("Rated", "计分") : tt("Casual", "休闲")} · {yourColor}
    </p>
  );

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const game = await acceptChallenge(await account.client(), code, settings.relayOnly);
      location.assign(nav.href(`/game?id=${game}`));
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setError(
        /taken/.test(m)
          ? tt("Someone has already accepted this challenge.", "该挑战已被他人接受。")
          : /blocked/.test(m)
            ? tt("You can't play this player.", "你无法与该棋手对弈。")
            : /not found/.test(m)
              ? tt("This challenge has expired.", "该挑战已过期。")
              : tt("Couldn't accept the challenge. Try again.", "无法接受挑战，请重试。"),
      );
      setBusy(false);
    }
  };

  return (
    <div className="online-page challenge-page">
      <h1>
        {info.mine
          ? tt("Your challenge", "你发起的挑战")
          : tt(`${info.from} challenges you`, `${info.from} 向你发起挑战`)}
        {!info.mine && info.rating !== null && <span className="muted"> ({info.rating})</span>}
      </h1>
      {terms}
      {info.expired ? (
        <p className="form-error">{tt("This challenge has expired.", "该挑战已过期。")}</p>
      ) : info.taken && !info.game ? (
        <p className="form-error">{tt("Someone has already accepted this challenge.", "该挑战已被他人接受。")}</p>
      ) : info.game ? (
        <a className="button primary" href={nav.href(`/game?id=${info.game}`)}>
          {tt("Go to the game", "进入对局")}
        </a>
      ) : info.mine ? (
        <p className="waiting" role="status">
          <span className="dot" aria-hidden /> {tt("Waiting for your friend to open this link…", "等待好友打开此链接…")}
        </p>
      ) : !signedIn ? (
        <p>
          {tt("Log in or sign up to accept.", "登录或注册后即可接受。")} <a href={`${nav.href("/login")}?next=${encodeURIComponent(`/challenge?c=${code}`)}`}>{tt("Log in", "登录")}</a> ·{" "}
          <a href={nav.href("/signup")}>{tt("Sign up", "注册")}</a>
        </p>
      ) : check && !check.eligible ? (
        <p>
          {tt("Before your first online game there are a few steps.", "首次在线对弈前需要完成几个步骤。")} <a href={nav.href("/online")}>{tt("See what's left", "查看还差什么")}</a>
        </p>
      ) : (
        <>
          {error && <p className="form-error">{error}</p>}
          <button type="button" className="primary big" disabled={busy || !check} onClick={() => void accept()}>
            {tt("Accept and play", "接受并开始")}
          </button>
        </>
      )}
      <p className="muted small">
        <a href={nav.href("/fair-play")}>{tt("Fair play", "公平竞技")}</a> · <a href={nav.href("/sportsmanship")}>{tt("Sportsmanship", "棋品规则")}</a>
      </p>
    </div>
  );
}
