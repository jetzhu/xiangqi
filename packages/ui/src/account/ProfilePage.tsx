"use client";
// Profile (M13): who the player is on the site and how far they've come. Private: only the
// player sees it, until online play brings public profiles.
import { BOTS, LESSON_ORDER } from "@xq/content";
import { learningRank } from "@xq/lessons";
import { PROVISIONAL_RD } from "@xq/puzzles";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "../bots/Avatar.js";
import { type BotRating, NEW_BOT_RATING } from "../bots/rating.js";
import type { Stars } from "../bots/stars.js";
import type { Progress } from "../learn/progress.js";
import { useNav } from "../nav.js";
import type { PuzzleState } from "../puzzles/store.js";
import { useT } from "../settings.js";
import { useStore } from "../store/index.js";
import { ChangeUsername } from "./AuthPages.js";
import { UserAvatar } from "./UserAvatar.js";
import { AVATARS, COUNTRIES, avatarFace, flagOf } from "./avatar.js";
import { useAccount } from "./session.js";

export function ProfilePage() {
  const { tt, t, lang } = useT();
  const nav = useNav();
  const account = useAccount();
  const store = useStore();
  const [progress, setProgress] = useState<Progress>({});
  const [stars, setStars] = useState<Stars>({});
  const [botRating, setBotRating] = useState<BotRating>(NEW_BOT_RATING);
  const [puzzles, setPuzzles] = useState<PuzzleState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void store.lessons.load().then(setProgress);
    void store.stars.load().then(setStars);
    void store.botRating.load().then(setBotRating);
    void store.puzzles.load().then(setPuzzles);
  }, [store]);

  const countryName = useMemo(() => {
    try {
      const names = new Intl.DisplayNames([lang === "zh" ? "zh-CN" : "en"], { type: "region" });
      return (code: string) => names.of(code) ?? code;
    } catch {
      return (code: string) => code;
    }
  }, [lang]);
  const countries = useMemo(() => [...COUNTRIES].sort((a, b) => countryName(a).localeCompare(countryName(b), lang === "zh" ? "zh-CN" : "en")), [countryName, lang]);

  const { state } = account;
  if (state.status === "loading") return <p className="muted" style={{ padding: 24 }}>…</p>;
  if (state.status !== "signedIn") {
    return (
      <div className="profile">
        <h1>{tt("Profile", "个人资料")}</h1>
        <p>
          {tt("Your profile comes with an account.", "注册账号后即可拥有个人资料。")}{" "}
          <a href={nav.href("/signup")}>{tt("Sign up", "注册")}</a> · <a href={`${nav.href("/login")}?next=/profile`}>{tt("Log in", "登录")}</a>
        </p>
      </div>
    );
  }
  const user = state.user;
  const mastered = LESSON_ORDER.filter((id) => progress[id] === "mastered").length;
  const { rank } = learningRank(mastered);

  const avatarLabel = (a: string | null) => {
    const face = avatarFace(a);
    if (!face) return tt("First letter of your username", "用户名首字母");
    const [color, piece] = a!.split("-");
    return tt(`${color === "red" ? "Red" : "Black"} ${piece}`, `${color === "red" ? "红" : "黑"}${face.char}`);
  };

  const save = async (patch: { avatar?: string | null; country?: string | null }) => {
    setSaving(true);
    setError(null);
    try {
      const sb = await account.client();
      const { error: e } = await sb.from("profiles").update(patch).eq("user_id", user.id);
      if (e) throw new Error(e.message);
      await account.refresh();
    } catch {
      setError(tt("Couldn't save that. Check your connection and try again.", "保存失败，请检查网络后重试。"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile">
      <section className="profile-head">
        <UserAvatar user={user} size={72} />
        <div>
          <h1>
            {user.username} {user.country && <span title={countryName(user.country)}>{flagOf(user.country)}</span>}
          </h1>
          <p className="muted">
            {tt("Member since", "注册于")} {new Date(user.memberSince).toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { year: "numeric", month: "long", day: "numeric" })} ·{" "}
            {tt("Only you can see your profile.", "个人资料仅你自己可见。")}
          </p>
        </div>
      </section>

      <section className="stat-cards" aria-label={tt("Ratings and rank", "等级分与等级")}>
        <div className="stat-card">
          <span className="muted">{tt("Bot rating", "人机等级分")}</span>
          <strong>
            {botRating.rating}
            {botRating.rd >= PROVISIONAL_RD ? "?" : ""}
          </strong>
          <span className="muted small">
            {botRating.games} {tt("rated games", "盘计分对局")}
          </span>
        </div>
        <div className="stat-card">
          <span className="muted">{tt("Puzzle rating", "解题等级分")}</span>
          <strong>{puzzles?.rating.rating ?? 800}</strong>
          <span className="muted small">
            {puzzles?.history.filter((h) => h.score > 0).length ?? 0} {tt("solved", "道已解")}
          </span>
        </div>
        <div className="stat-card">
          <span className="muted">{tt("Learning rank", "学习等级")}</span>
          <strong>{t(rank.name)}</strong>
          <span className="muted small">
            {mastered}/{LESSON_ORDER.length} {tt("lessons mastered", "课已掌握")}
          </span>
        </div>
      </section>

      <section aria-labelledby="h-bots">
        <h2 id="h-bots">{tt("Bots beaten", "已战胜的机器人")}</h2>
        <ul className="profile-bots">
          {BOTS.map((b) => (
            <li key={b.id} className={stars[b.id] ? "beaten" : ""}>
              <Avatar bot={b} size={40} stars={stars[b.id] ?? 0} />
              <span className="small">{t(b.name)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="h-edit">
        <h2 id="h-edit">{tt("Edit profile", "编辑资料")}</h2>
        <fieldset className="avatar-picker" disabled={saving}>
          <legend>{tt("Avatar", "头像")}</legend>
          {[null, ...AVATARS].map((a) => (
            <button
              key={a ?? "initial"}
              type="button"
              aria-pressed={user.avatar === a}
              aria-label={avatarLabel(a)}
              className={user.avatar === a ? "active" : ""}
              onClick={() => void save({ avatar: a })}
            >
              <UserAvatar user={{ username: user.username, avatar: a }} size={36} />
            </button>
          ))}
        </fieldset>
        <label className="country-picker">
          {tt("Country or region (optional)", "国家或地区（可选）")}
          <select value={user.country ?? ""} disabled={saving} onChange={(e) => void save({ country: e.target.value || null })}>
            <option value="">{tt("Don't show", "不显示")}</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {flagOf(c)} {countryName(c)}
              </option>
            ))}
          </select>
        </label>
        <ChangeUsername />
        {error && <p className="form-error">{error}</p>}
      </section>
    </div>
  );
}
