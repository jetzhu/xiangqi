"use client";
// A player's public profile (M15): what any visitor may see, at /player?u=<username>. The
// player's own private page stays at /profile.
import { PROVISIONAL_RD } from "@xq/puzzles";
import { useEffect, useState } from "react";
import { UserAvatar } from "../account/UserAvatar.js";
import { flagOf } from "../account/avatar.js";
import { useAccount } from "../account/session.js";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import { type PublicProfile, SPEEDS, type Speed, publicProfile, setBlocked } from "./api.js";

export const SPEED_NAME: Record<Speed, { en: string; zh: string }> = {
  lightning: { en: "Lightning", zh: "闪电" },
  blitz: { en: "Blitz", zh: "超快棋" },
  rapid: { en: "Rapid", zh: "快棋" },
};

export function PlayerPage() {
  const { tt, t, lang } = useT();
  const nav = useNav();
  const account = useAccount();
  const name = nav.params().get("u") ?? "";
  const [profile, setProfile] = useState<PublicProfile | null | "loading" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const signedIn = account.state.status === "signedIn";

  useEffect(() => {
    if (!name) return setProfile(null);
    let live = true;
    account
      .client()
      .then((sb) => publicProfile(sb, name))
      .then((p) => live && setProfile(p))
      .catch(() => live && setProfile("error"));
    return () => {
      live = false;
    };
  }, [name, account.state.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (profile === "loading") return <p className="muted" style={{ padding: 24 }}>…</p>;
  if (profile === "error") return <p className="form-error" style={{ padding: 24 }}>{tt("Couldn't load this profile. Check your connection and try again.", "无法载入该资料，请检查网络后重试。")}</p>;
  if (!profile) {
    return (
      <div className="profile">
        <h1>{tt("Player not found", "找不到该棋手")}</h1>
        <p className="muted">{tt(`There's no player called "${name}".`, `没有名为“${name}”的棋手。`)}</p>
      </div>
    );
  }

  const country = (() => {
    if (!profile.country) return null;
    try {
      return new Intl.DisplayNames([lang === "zh" ? "zh-CN" : "en"], { type: "region" }).of(profile.country) ?? profile.country;
    } catch {
      return profile.country;
    }
  })();

  const toggleBlock = async () => {
    setBusy(true);
    try {
      const sb = await account.client();
      await setBlocked(sb, profile.username, !profile.blocked);
      setProfile({ ...profile, blocked: !profile.blocked });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile">
      <section className="profile-head">
        <UserAvatar user={{ username: profile.username, avatar: profile.avatar }} size={72} />
        <div>
          <h1>
            {profile.username} {profile.country && <span title={country ?? undefined}>{flagOf(profile.country)}</span>}
          </h1>
          {profile.member_since && (
            <p className="muted">
              {tt("Member since", "注册于")}{" "}
              {new Date(profile.member_since).toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { year: "numeric", month: "long", day: "numeric" })}
            </p>
          )}
          {profile.me && (
            <p className="muted small">
              {tt("This is how other players see you.", "这是其他棋手看到的你的资料。")} <a href={nav.href("/profile")}>{tt("Edit profile", "编辑资料")}</a>
            </p>
          )}
        </div>
      </section>

      {profile.violation && (
        <p className="form-error" role="note">
          {tt("Fair-play violation confirmed on", "经核实违反公平竞技规则，日期：")} {new Date(profile.violation.at).toLocaleDateString(lang === "zh" ? "zh-CN" : "en")}
        </p>
      )}

      <section className="stat-cards" aria-label={tt("Online ratings", "在线等级分")}>
        {SPEEDS.map((s) => {
          const r = profile.ratings[s];
          return (
            <div key={s} className="stat-card">
              <span className="muted">{t(SPEED_NAME[s])}</span>
              <strong>{r ? `${r.rating}${r.rd >= PROVISIONAL_RD ? "?" : ""}` : "—"}</strong>
              <span className="muted small">
                {r ? r.games : 0} {tt("rated games", "盘计分对局")}
              </span>
            </div>
          );
        })}
      </section>

      <section aria-labelledby="h-fairplay">
        <h2 id="h-fairplay">{tt("Fair-play record", "公平记录")}</h2>
        <dl className="fairplay-record">
          <dt>{tt("Completion rate", "棋品（完成率）")}</dt>
          <dd>{profile.completion === null ? tt("No online games yet", "暂无在线对局") : `${profile.completion} %`}</dd>
          <dt>{tt("Fair-play checked games", "公平性已检查对局")}</dt>
          <dd>{profile.checked_games ? tt(`${profile.checked_games} checked, none flagged`, `已检查 ${profile.checked_games} 盘，均无问题`) : "—"}</dd>
        </dl>
        <p className="muted small">
          <a href={nav.href("/fair-play")}>{tt("How fair play works", "公平竞技规则")}</a> · <a href={nav.href("/sportsmanship")}>{tt("Sportsmanship", "棋品规则")}</a>
        </p>
      </section>

      {signedIn && !profile.me && (
        <section>
          <button type="button" disabled={busy} onClick={() => void toggleBlock()}>
            {profile.blocked ? tt("Unblock", "取消屏蔽") : tt("Block", "屏蔽")}
          </button>{" "}
          <span className="muted small">
            {profile.blocked
              ? tt("You won't be matched with this player, and they can't challenge you.", "你不会与该棋手匹配，对方也无法向你发起挑战。")
              : tt("Blocking keeps this player out of your games.", "屏蔽后，你不会再与该棋手对局。")}
          </span>
        </section>
      )}
    </div>
  );
}
