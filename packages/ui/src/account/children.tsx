"use client";
// Child profiles (M24, docs/v0.4-design.md "Child profiles"): a parent makes profiles for
// children under 13 from their own account and opens one on their device; the child uses
// lessons, puzzles, bots and analysis with their progress saved, and nothing else. Consent is
// "email plus": the notice here, a confirmation link by email, and a second email a day later.
import type { SupabaseClient } from "@supabase/supabase-js";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import { COUNTRIES } from "./avatar.js";
import { download } from "./exportData.js";
import { ConfirmItsYou, HintError } from "./security.js";
import { type Provider, useAccount } from "./session.js";

/** The notice a parent agrees to; the database knows the same version (child_notice_version). */
export const NOTICE_VERSION = "v1-2026-10-22";

interface Child {
  id: string;
  nickname: string;
  birth_year: number;
  country: string;
  status: "unconfirmed" | "confirmed";
  created_at: string;
  last_used: string | null;
  can_graduate: boolean;
  lessons: number;
  bot_games: number;
  puzzle_rating: number | null;
  bot_rating: number | null;
  days_active_30: number;
}

async function rpc<T>(sb: SupabaseClient, fn: string, args?: object): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new HintError(error.message, error.hint || null);
  return data as T;
}

/** Calls the `child` server function; its refusals carry the database's hint. */
async function childFunction<T>(sb: SupabaseClient, body: object): Promise<T> {
  const { data, error } = await sb.functions.invoke("child", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const detail = ctx ? ((await ctx.json().catch(() => null)) as { error?: string; hint?: string } | null) : null;
    throw new HintError(detail?.error ?? error.message, detail?.hint ?? null);
  }
  return data as T;
}

function useChildHint() {
  const { tt } = useT();
  return (e: unknown) => {
    switch (e instanceof HintError ? e.hint : null) {
      case "reauth":
        return tt("Please confirm it's you again.", "请重新确认是你本人。");
      case "adult":
        return tt("Child profiles are made by parents aged 18 or over (add your birth month in Settings → Online play).", "孩子档案需由年满 18 岁的家长建立（请在“设置 → 在线对弈”中填写出生年月）。");
      case "email":
        return tt("Confirm your own email first.", "请先确认你自己的邮箱。");
      case "china":
        return tt("Child profiles aren't offered in mainland China yet. Your child can still use everything as a guest on this device.", "孩子档案暂不向中国大陆提供。孩子仍可在此设备上以访客身份使用全部学习功能。");
      case "country":
        return tt("Choose your child's country.", "请选择孩子所在的国家或地区。");
      case "notice":
        return tt("The notice has changed: please read it again.", "说明已更新：请重新阅读。");
      case "statement":
        return tt("Please type 동의 (I agree) or your own statement of consent.", "请输入“동의”（我同意）或您自己的同意声明。");
      case "nickname":
        return tt("A nickname of up to 20 letters.", "昵称最多 20 个字。");
      case "age":
        return tt("Child profiles are for children under 13. From 13, your child can have their own account.", "孩子档案适用于 13 岁以下的孩子。年满 13 岁后可以注册自己的账号。");
      case "limit":
        return tt("You can have 3 child profiles.", "最多可建立 3 个孩子档案。");
      case "unconfirmed":
        return tt("Confirm this profile from the email we sent you first.", "请先通过我们发送的邮件确认此档案。");
      case "young":
        return tt("From 13.", "年满 13 岁后可用。");
      case "taken":
        return tt("Another account uses that email.", "另一个账号正在使用该邮箱。");
      case "expired":
        return tt("This link has expired or was already used.", "此链接已过期或已使用。");
      default:
        return e instanceof Error ? e.message : String(e);
    }
  };
}

/** The notice to parents (what, why, how long, where, who, their rights), in both languages. */
export function ChildNotice() {
  const { tt } = useT();
  const items: [string, string][] = [
    [
      "What we keep: the nickname, birth year and country you give, and your child's lessons, puzzles, bot games, ratings, saved analyses and settings, so their progress is saved. No email, no password, no photo, no full name.",
      "保存的内容：您填写的昵称、出生年份和国家/地区，以及孩子的课程、题目、人机对局、等级分、保存的分析和设置，以便保存学习进度。不保存邮箱、密码、照片或真实姓名。",
    ],
    ["Why: only to run the site for your child. Never ads, never sold, never used to train AI.", "用途：仅为孩子提供网站服务。没有广告，不出售，不用于训练 AI。"],
    [
      "Who sees it: only you, and your child on your device. No online play, no chat, no public profile or leaderboard, and no coach other than you.",
      "谁能看到：只有您，以及在您设备上使用的孩子。没有在线对弈、聊天、公开资料或排行榜，除您以外没有其他教练。",
    ],
    [
      "Where: Supabase (our database service) on servers in the United States; our emails to you go through Gmail. They process it only for us.",
      "存储地点：Supabase（我们的数据库服务），服务器位于美国；发给您的邮件通过 Gmail 发送。它们仅代我们处理这些信息。",
    ],
    [
      "How long: until you delete it. Unconfirmed profiles go after 14 days; profiles unused for 24 months go after a warning. A record of your consent is kept 3 years after, as proof.",
      "保存期限：直到您删除。未确认的档案 14 天后删除；24 个月未使用的档案在提醒后删除。同意记录在档案结束后保留 3 年作为证明。",
    ],
    [
      "Your rights: see, download or delete everything at any time in Settings → Children; deleting also withdraws your consent. Questions: the contact in our privacy policy.",
      "您的权利：可随时在“设置 → 孩子”中查看、下载或删除全部内容；删除即撤回同意。如有疑问，请使用隐私政策中的联系方式。",
    ],
  ];
  return (
    <div className="child-notice">
      <h3>{tt("Notice to parents", "致家长的说明")}</h3>
      <ul>
        {items.map(([en, zh], i) => (
          <li key={i}>{tt(en, zh)}</li>
        ))}
      </ul>
    </div>
  );
}

/** Settings → Children (and /children): a parent's child profiles. */
export function ChildrenPage() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [children, setChildren] = useState<Child[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [identities, setIdentities] = useState<{ hasPassword: boolean; provider: Provider | undefined }>({ hasPassword: false, provider: undefined });
  const signedIn = account.state.status === "signedIn";
  const load = useCallback(() => {
    void account.client().then(async (sb) => {
      setChildren(await rpc<Child[]>(sb, "my_children").catch(() => []));
      const { data } = await sb.auth.getUserIdentities();
      const ids = data?.identities ?? [];
      setIdentities({ hasPassword: ids.some((i) => i.provider === "email"), provider: ids.find((i) => i.provider !== "email")?.provider as Provider | undefined });
    });
  }, [account]);
  useEffect(() => {
    if (signedIn) load();
  }, [signedIn, load]);

  if (account.state.status === "loading") return <p className="muted" style={{ padding: 24 }}>…</p>;
  if (account.state.status !== "signedIn") {
    return (
      <div className="help children-page">
        <h1>{tt("Child profiles", "孩子档案")}</h1>
        <p>
          <a href={nav.href("/login")}>{tt("Log in", "登录")}</a> {tt("to make profiles for your children under 13.", "后可以为 13 岁以下的孩子建立档案。")}
        </p>
      </div>
    );
  }
  if (account.state.user.child) return <p style={{ padding: 24 }}>{tt("This page is for parents.", "此页面供家长使用。")}</p>;
  return (
    <div className="help children-page">
      <h1>{tt("Child profiles", "孩子档案")}</h1>
      <p>
        {tt(
          "For children under 13: lessons, puzzles, bots and analysis, with their progress saved, on your device. You're their only coach: you see everything they do here. No online play, no chat, no public profile.",
          "适用于 13 岁以下的孩子：在您的设备上使用课程、题目、人机对弈和分析，并保存学习进度。您是孩子唯一的教练：可以看到孩子在这里的全部记录。没有在线对弈、聊天或公开资料。",
        )}
      </p>
      {children === null ? (
        <p className="muted">…</p>
      ) : (
        <ul className="children-list">
          {children.map((c) => (
            <ChildCard key={c.id} c={c} identities={identities} reload={load} />
          ))}
        </ul>
      )}
      {children && children.length < 3 && (adding ? <AddChild identities={identities} onDone={() => (setAdding(false), load())} /> : <button type="button" className="primary" onClick={() => setAdding(true)}>{tt("Add a child profile", "添加孩子档案")}</button>)}
      {children && children.length >= 3 && <p className="muted">{tt("You have 3 child profiles, the most there can be.", "您已有 3 个孩子档案，已达上限。")}</p>}
      <p className="muted small">
        <a href={nav.href("/privacy")}>{tt("Privacy policy: children", "隐私政策：儿童")}</a>
      </p>
    </div>
  );
}

function ChildCard({ c, identities, reload }: { c: Child; identities: { hasPassword: boolean; provider: Provider | undefined }; reload: () => void }) {
  const { tt, lang } = useT();
  const nav = useNav();
  const account = useAccount();
  const hintText = useChildHint();
  const [confirming, setConfirming] = useState<null | "delete" | "graduate">(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const age = new Date().getFullYear() - c.birth_year;

  const open = async () => {
    setMessage(null);
    try {
      const sb = await account.client();
      const { token_hash } = await childFunction<{ token_hash: string }>(sb, { action: "switch", child: c.id });
      await account.signOut("local");
      const { error } = await sb.auth.verifyOtp({ token_hash, type: "magiclink" });
      if (error) throw error;
      await account.refresh();
      location.assign(nav.href("/learn"));
    } catch (e) {
      setMessage(hintText(e));
    }
  };
  const exportData = async () => {
    const data = await rpc<object>(await account.client(), "child_export", { p_child: c.id });
    download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `xiangqi-child-${c.nickname}-${new Date().toISOString().slice(0, 10)}.json`);
  };
  const act = async () => {
    setMessage(null);
    try {
      const sb = await account.client();
      if (confirming === "delete") {
        await rpc(sb, "delete_child", { p_child: c.id, p_withdraw: true });
        setConfirming(null);
        reload();
      } else {
        await rpc(sb, "start_child_graduation", { p_child: c.id, p_email: email });
        setConfirming(null);
        setMessage(tt(`We've emailed ${email}: opening the link there turns this profile into ${c.nickname}'s own account.`, `我们已发送邮件到 ${email}：打开其中的链接即可把此档案转为 ${c.nickname} 自己的账号。`));
      }
    } catch (e) {
      setConfirming(null);
      setMessage(hintText(e));
    }
  };
  return (
    <li className="child-card">
      <h2>
        {c.nickname} <span className="muted small">{tt(`about ${age}`, `约 ${age} 岁`)}</span>
      </h2>
      {c.status === "unconfirmed" ? (
        <p>{tt("Waiting for you: open the link we emailed you to confirm this profile (within 14 days).", "等待确认：请打开我们发送给您的邮件中的链接确认此档案（14 天内）。")}</p>
      ) : (
        <>
          <p className="small">
            {tt(`${c.lessons} lessons mastered · ${c.bot_games} bot games`, `已掌握 ${c.lessons} 课 · 人机对局 ${c.bot_games} 盘`)}
            {c.puzzle_rating !== null && ` · ${tt("puzzle rating", "题目等级分")} ${c.puzzle_rating}`}
            {c.bot_rating !== null && ` · ${tt("bot rating", "人机等级分")} ${c.bot_rating}`} · {tt(`active ${c.days_active_30} days in the last 30`, `近 30 天活跃 ${c.days_active_30} 天`)}
            {c.last_used && ` · ${tt("last used", "上次使用")} ${new Date(c.last_used).toLocaleDateString(lang === "zh" ? "zh-CN" : "en")}`}
          </p>
          <p>
            <button type="button" className="primary" onClick={() => void open()}>
              {tt(`Open ${c.nickname}'s profile on this device`, `在此设备上打开 ${c.nickname} 的档案`)}
            </button>
          </p>
          <p className="muted small">
            {tt(
              "This signs you out here and signs your child in. To come back to your account, sign out and sign in again.",
              "这会让您在此设备上退出登录，并让孩子登录。要回到您的账号，请退出后重新登录。",
            )}
          </p>
        </>
      )}
      <p className="row">
        <button type="button" onClick={() => void exportData()}>
          {tt("Download everything", "下载全部数据")}
        </button>{" "}
        {c.can_graduate && c.status === "confirmed" && (
          <button type="button" onClick={() => setConfirming("graduate")}>
            {tt("Turn into their own account", "转为孩子自己的账号")}
          </button>
        )}{" "}
        <button type="button" onClick={() => setConfirming("delete")}>
          {tt("Delete (withdraws consent)", "删除（撤回同意）")}
        </button>
      </p>
      {confirming === "graduate" && (
        <label>
          {tt(`${c.nickname}'s email`, `${c.nickname} 的邮箱`)} <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      )}
      {confirming && (confirming === "delete" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) && (
        <>
          {confirming === "delete" && <p className="form-error">{tt(`Delete ${c.nickname}'s profile and everything in it, now? This can't be undone.`, `立即删除 ${c.nickname} 的档案及其全部内容？此操作无法撤销。`)}</p>}
          <ConfirmItsYou hasPassword={identities.hasPassword} provider={identities.provider} returnTo="/children" onConfirmed={() => void act()} />
        </>
      )}
      {message && <p role="status">{message}</p>}
    </li>
  );
}

function AddChild({ identities, onDone }: { identities: { hasPassword: boolean; provider: Provider | undefined }; onDone: () => void }) {
  const { tt, lang } = useT();
  const account = useAccount();
  const hintText = useChildHint();
  const year = new Date().getFullYear();
  const [nickname, setNickname] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [country, setCountry] = useState("");
  const [agree, setAgree] = useState(false);
  const [statement, setStatement] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const names = useMemo(() => {
    try {
      const dn = new Intl.DisplayNames([lang === "zh" ? "zh-CN" : "en"], { type: "region" });
      return (c: string) => dn.of(c) ?? c;
    } catch {
      return (c: string) => c;
    }
  }, [lang]);
  const countries = useMemo(() => [...COUNTRIES].sort((a, b) => names(a).localeCompare(names(b), lang === "zh" ? "zh-CN" : "en")), [names, lang]);
  const ready = nickname.trim() && birthYear && country && agree && (country !== "KR" || statement.trim()) && country !== "CN";

  const create = useCallback(async () => {
    setError(null);
    try {
      await childFunction(await account.client(), { action: "create", nickname: nickname.trim(), birthYear: Number(birthYear), country, notice: NOTICE_VERSION, statement: country === "KR" ? statement.trim() : null });
      setDone(true);
    } catch (e) {
      setConfirming(false);
      setError(hintText(e));
    }
  }, [account, nickname, birthYear, country, statement, hintText]);

  if (done) {
    return (
      <div role="status" className="child-card">
        <p>
          {tt(
            `Almost done: we've emailed you a link. Open it to confirm ${nickname}'s profile; nothing is kept for good until you do (14 days).`,
            `快完成了：我们已向您发送邮件。请打开其中的链接确认 ${nickname} 的档案；确认前不会长期保存任何内容（14 天）。`,
          )}
        </p>
        <button type="button" onClick={onDone}>
          {tt("OK", "好的")}
        </button>
      </div>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setConfirming(true);
  };
  return (
    <form className="contact-form child-card" onSubmit={submit}>
      <h2>{tt("Add a child profile", "添加孩子档案")}</h2>
      <label>
        {tt("Nickname (not their full name; only you and your child see it)", "昵称（不要用真实姓名；只有您和孩子能看到）")}
        <input value={nickname} maxLength={20} onChange={(e) => setNickname(e.target.value)} required />
      </label>
      <label>
        {tt("Year of birth", "出生年份")}
        <select value={birthYear} onChange={(e) => setBirthYear(e.target.value)} required>
          <option value="">–</option>
          {Array.from({ length: 12 }, (_, i) => year - 2 - i).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label>
        {tt("Country or region", "国家或地区")}
        <select value={country} onChange={(e) => setCountry(e.target.value)} required>
          <option value="">–</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {names(c)}
            </option>
          ))}
        </select>
      </label>
      {country === "CN" && <p className="form-error">{hintText(new HintError("", "china"))}</p>}
      <ChildNotice />
      <label className="inline">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />{" "}
        {tt("I'm this child's parent or legal guardian, and I agree to the notice above.", "我是这个孩子的家长或法定监护人，并同意以上说明。")}
      </label>
      {country === "KR" && (
        <label>
          {tt("Korea: type 동의 (I agree), or your own statement of consent", "韩国：请输入“동의”（我同意）或您自己的同意声明")}
          <input value={statement} maxLength={300} onChange={(e) => setStatement(e.target.value)} lang="ko" />
        </label>
      )}
      {confirming ? (
        <ConfirmItsYou hasPassword={identities.hasPassword} provider={identities.provider} returnTo="/children" onConfirmed={() => void create()} />
      ) : (
        <button type="submit" className="primary" disabled={!ready}>
          {tt("Create the profile", "建立档案")}
        </button>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
}

/** The link in the consent email: the parent confirms ("email plus", step one). */
export function ChildConfirmPage() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const hintText = useChildHint();
  const token = nav.params().get("t") ?? "";
  const [v, setV] = useState<{ nickname: string | null; confirmed: boolean; ended: boolean; expired: boolean } | null | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(() => {
    if (account.state.status === "loading" || account.state.status === "off") return;
    void account
      .client()
      .then((sb) => rpc<typeof v>(sb, "child_consent_view", { p_token: token }))
      .then(setV, () => setV(null));
  }, [account, token]);
  useEffect(load, [load]);
  if (v === undefined) return <p className="muted" style={{ padding: 24 }}>…</p>;
  const page = (children: ReactNode) => (
    <div className="help children-page">
      <h1>{tt("Confirm a child profile", "确认孩子档案")}</h1>
      {children}
    </div>
  );
  if (!v || v.ended || v.expired) return page(<p>{tt("This link has expired or isn't valid.", "此链接已过期或无效。")}</p>);
  if (v.confirmed)
    return page(
      <p>
        {tt(`${v.nickname}'s profile is confirmed. Open it from `, `${v.nickname} 的档案已确认。请在`)}
        <a href={nav.href("/children")}>{tt("Child profiles", "孩子档案")}</a>
        {tt(".", "中打开。")}
      </p>,
    );
  return page(
    <>
      <p>{tt(`Confirm the child profile "${v.nickname}" and your agreement to the notice below.`, `确认孩子档案"${v.nickname}"，并同意以下说明。`)}</p>
      <ChildNotice />
      <button
        type="button"
        className="primary"
        onClick={() =>
          void (async () => {
            try {
              await rpc(await account.client(), "child_confirm", { p_token: token });
              setMessage(null);
              load();
            } catch (e) {
              setMessage(hintText(e));
            }
          })()
        }
      >
        {tt("I'm the parent or guardian: confirm", "我是家长或监护人：确认")}
      </button>
      {message && <p role="alert">{message}</p>}
    </>,
  );
}

/** The link sent at 13: the profile becomes the child's own account. */
export function ChildAccountPage() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const hintText = useChildHint();
  const token = nav.params().get("t") ?? "";
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finish = async () => {
    setError(null);
    try {
      setDone(await rpc<string>(await account.client(), "finish_child_graduation", { p_token: token }));
    } catch (e) {
      setError(hintText(e));
    }
  };
  return (
    <div className="help children-page">
      <h1>{tt("Your own account", "你自己的账号")}</h1>
      {done ? (
        <p role="status">
          {tt(`Done: the account is now yours, with the email ${done}. Set a password with `, `完成：账号现在属于你，邮箱为 ${done}。请用`)}
          <a href={nav.href("/reset-password")}>{tt("Forgot password", "忘记密码")}</a>
          {tt(", then sign in. Your lessons, games and ratings are all there.", "设置密码，然后登录。你的课程、对局和等级分都还在。")}
        </p>
      ) : (
        <>
          <p>{tt("Your parent asked to turn your profile into your own account. Your progress stays.", "你的家长申请把你的档案转为你自己的账号。你的进度都会保留。")}</p>
          <button type="button" className="primary" onClick={() => void finish()}>
            {tt("Make it my account", "转为我的账号")}
          </button>
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}

/**
 * On every page while a child profile is open: whose it is, that the parent can see their
 * progress (said plainly for the child), and how to go back. In Vietnam a child of 7 or over is
 * asked first whether that's all right.
 */
export function ChildBanner() {
  const { tt } = useT();
  const account = useAccount();
  const child = account.state.status === "signedIn" && account.state.user.child;
  const [me, setMe] = useState<{ nickname: string; ask_agreement: boolean } | null>(null);
  useEffect(() => {
    if (!child) return setMe(null);
    void account.client().then(async (sb) => {
      setMe(await rpc<{ nickname: string; ask_agreement: boolean }>(sb, "my_child_profile").catch(() => null));
      void rpc(sb, "child_used").catch(() => {});
    });
  }, [child]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!child || !me) return null;
  const back = (
    <button type="button" className="link" onClick={() => void account.signOut()}>
      {tt("Grown-ups: back to your account (sign out)", "家长：回到您的账号（退出登录）")}
    </button>
  );
  if (me.ask_agreement) {
    return (
      <div className="mfa-gate" role="dialog" aria-modal="true" aria-labelledby="h-child-ok">
        <div className="mfa-gate-box">
          <h2 id="h-child-ok">{tt(`Hi ${me.nickname}!`, `你好，${me.nickname}！`)}</h2>
          <p>{tt("Your parent can see your lessons, puzzles and games here. Is that OK with you?", "你的家长可以看到你在这里的课程、题目和对局。你同意吗？")}</p>
          <p>
            <button
              type="button"
              className="primary"
              onClick={() =>
                void (async () => {
                  await rpc(await account.client(), "child_agree").catch(() => {});
                  setMe({ ...me, ask_agreement: false });
                })()
              }
            >
              {tt("Yes, that's OK", "好的，我同意")}
            </button>
          </p>
          <p className="small">
            {tt("Not sure? Ask your parent first.", "不确定？先问问你的家长。")} {back}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="update-banner child-banner" role="status">
      {tt(`${me.nickname}'s profile. Your parent can see your progress here.`, `${me.nickname} 的档案。你的家长可以看到你在这里的进度。`)} {back}
    </div>
  );
}

