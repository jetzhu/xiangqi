"use client";
// Play online: what a player needs before their first online game (decision D9, M15), the one
// birth month online play needs, and then the way in (Play a friend, M16).
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useAccount } from "../account/session.js";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import { type Eligibility, LONG_GAMES_NEEDED, LONG_GAME_MOVES, onlineEligibility } from "./api.js";
import { BirthMonthForm, useMonthName } from "./BirthMonth.js";

export function OnlinePage() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [check, setCheck] = useState<Eligibility | null | "error">(null);
  const signedIn = account.state.status === "signedIn";

  const load = useCallback(() => {
    void account
      .client()
      .then(onlineEligibility)
      .then(setCheck)
      .catch(() => setCheck("error"));
  }, [account]);
  useEffect(() => {
    if (signedIn) load();
  }, [signedIn, load]);

  const monthName = useMonthName();

  const intro = (
    <>
      <h1>{tt("Play online", "在线对弈")}</h1>
      <p className="sub">
        {tt(
          "Play a friend now with a challenge link. Quick pairing with people of your level comes with v0.3. Lightning, Blitz and Rapid each have their own rating.",
          "现在就可以用挑战链接与好友对弈；与水平相近的棋手快速匹配将在 v0.3 推出。闪电、超快棋、快棋各有独立等级分。",
        )}
      </p>
    </>
  );

  if (account.state.status === "loading") return <p className="muted" style={{ padding: 24 }}>…</p>;
  if (!signedIn) {
    return (
      <div className="online-page">
        {intro}
        <p>
          {tt("Online play needs a free account.", "在线对弈需要免费账号。")} <a href={nav.href("/signup")}>{tt("Sign up", "注册")}</a> ·{" "}
          <a href={`${nav.href("/login")}?next=/online`}>{tt("Log in", "登录")}</a>
        </p>
      </div>
    );
  }
  if (check === "error") return <p className="form-error" style={{ padding: 24 }}>{tt("Couldn't load your progress. Check your connection and try again.", "无法载入进度，请检查网络后重试。")}</p>;
  if (!check) return <p className="muted" style={{ padding: 24 }}>…</p>;

  const gamesLeft = Math.max(0, LONG_GAMES_NEEDED - check.long_games);

  return (
    <div className="online-page">
      {intro}
      <h2>
        {check.eligible
          ? tt("You're ready for online play", "你已具备在线对弈资格")
          : check.casual_ok
            ? tt("Before rated games", "计分对局前")
            : tt("Before your first online game", "首次在线对弈前")}
      </h2>
      <ul className="checklist">
        <Item done={check.verified}>{tt("A verified email", "已验证的邮箱")}</Item>
        <Item done={check.age_answered}>
          {tt("Your birth month", "你的出生年月")}
          {check.born ? `: ${monthName(check.born)}` : <BirthMonthForm check={check} onSaved={load} label={tt("Your birth month", "你的出生年月")} />}
        </Item>
        <Item done={check.clean_win || gamesLeft === 0}>
          {tt("One of these:", "以下任意一项：")}
          <ul>
            <Item done={check.clean_win}>
              {tt(
                `Win against a bot rated ${check.target} or more without hints or takebacks`,
                `不用提示和悔棋，战胜一个等级分不低于 ${check.target} 的机器人`,
              )}{" "}
              (<a href={nav.href("/bots")}>{tt("Play bots", "人机对弈")}</a>)
            </Item>
            <Item done={gamesLeft === 0}>
              {tt(
                `Finish ${LONG_GAMES_NEEDED} bot games of at least ${LONG_GAME_MOVES} moves each: ${Math.min(check.long_games, LONG_GAMES_NEEDED)} of ${LONG_GAMES_NEEDED} played`,
                `完成 ${LONG_GAMES_NEEDED} 盘每方至少 ${LONG_GAME_MOVES} 步的人机对局：已完成 ${Math.min(check.long_games, LONG_GAMES_NEEDED)}/${LONG_GAMES_NEEDED}`,
              )}
            </Item>
          </ul>
        </Item>
      </ul>
      {check.casual_ok && (
        <p>
          <a className="button primary big" href={nav.href("/friend")}>
            {tt("Play a friend", "与好友对弈")}
          </a>
          {!check.eligible && <span className="muted small"> {tt("Casual games now; rated ones once the steps above are done.", "现在可以下休闲对局；完成上述步骤后即可下计分对局。")}</span>}
        </p>
      )}
      {check.age_answered && check.under16 && (
        <p className="muted small">
          {tt(
            "Under 16: your public profile shows only your username and ratings, and your games always go through our server, so opponents never see your network address. This lifts by itself when you turn 16.",
            "16 岁以下：公开资料只显示用户名和等级分；你的对局始终经服务器中转，对手看不到你的网络地址。年满 16 岁后自动解除。",
          )}
        </p>
      )}
      <p className="muted small">
        {tt("Bot games count once they're saved to your account.", "人机对局保存到账号后才计入。")}{" "}
        <a href={nav.href("/fair-play")}>{tt("Fair play", "公平竞技")}</a> · <a href={nav.href("/sportsmanship")}>{tt("Sportsmanship", "棋品规则")}</a> ·{" "}
        <a href={nav.href("/settings?tab=online")}>{tt("Online settings", "在线对弈设置")}</a>
      </p>
    </div>
  );
}

/** A checklist line. Kept outside OnlinePage so a re-render doesn't remount the birth month form. */
function Item({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className={done ? "done" : ""}>
      <span aria-hidden>{done ? "✓" : "○"}</span> {children}
    </li>
  );
}
