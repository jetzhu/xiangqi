"use client";
// Account security (M23b, docs/v0.4-design.md): two-factor sign-in with an authenticator app,
// the code asked after signing in, "Confirm it's you" before sensitive changes, and the site's
// own email change (the old address approves or denies; silence approves after 10 days; two-
// factor skips the wait; the old address can undo it for 30 days).
import type { SupabaseClient } from "@supabase/supabase-js";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import { Field, FormError, authErrorText, callbackUrl, rememberNext } from "./AuthPages.js";
import { PROVIDERS, type Provider, useAccount } from "./session.js";

// Database calls --------------------------------------------------------------------------------

export class HintError extends Error {
  constructor(
    message: string,
    readonly hint: string | null,
  ) {
    super(message);
  }
}
async function rpc<T>(sb: SupabaseClient, fn: string, args?: object): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new HintError(error.message, error.hint || null);
  return data as T;
}

export interface MyEmailChange {
  change: { status: "confirm-new" | "waiting"; new: string; due_at: string | null; fast: boolean } | null;
  locked_until: string | null;
  frozen: boolean;
  mfa: boolean;
}
export interface EmailChangeView {
  kind: "new" | "old" | "undo";
  status: string;
  old: string;
  new: string;
  username: string;
  due_at: string | null;
  undo_until: string | null;
  expired: boolean;
}
export const myEmailChange = (sb: SupabaseClient) => rpc<MyEmailChange>(sb, "my_email_change");
export const startEmailChange = (sb: SupabaseClient, email: string) => rpc<{ status: string }>(sb, "start_email_change", { p_new: email });
export const cancelEmailChange = (sb: SupabaseClient) => rpc<null>(sb, "cancel_email_change");
export const emailChangeView = (sb: SupabaseClient, token: string) => rpc<EmailChangeView | null>(sb, "email_change_view", { p_token: token });
export const confirmNewEmail = (sb: SupabaseClient, token: string) => rpc<"done" | "waiting">(sb, "confirm_new_email", { p_token: token });
export const answerOldEmail = (sb: SupabaseClient, token: string, approve: boolean) => rpc<"done" | "denied">(sb, "answer_old_email", { p_token: token, p_approve: approve });
export const undoEmailChange = (sb: SupabaseClient, token: string) => rpc<null>(sb, "undo_email_change", { p_token: token });

// Two-factor ----------------------------------------------------------------------------------------

/** The session's two-factor level, and when it last signed in (seconds since 1970). */
export async function assurance(sb: SupabaseClient) {
  const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  const methods = (data?.currentAuthenticationMethods ?? []) as ({ timestamp: number } | string)[];
  const last = Math.max(0, ...methods.map((m) => (typeof m === "string" ? 0 : m.timestamp)));
  return { current: data?.currentLevel ?? null, next: data?.nextLevel ?? null, lastSignIn: last };
}

/** Asks for a code from the authenticator app and raises the session to two-factor. */
export function CodePrompt({ onDone, children, factorId }: { onDone: () => void; children?: ReactNode; factorId?: string }) {
  const { tt } = useT();
  const account = useAccount();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const sb = await account.client();
    // While turning it on, the new (not yet verified) authenticator; otherwise the account's.
    const id = factorId ?? (await sb.auth.mfa.listFactors()).data?.totp.find((f) => f.status === "verified")?.id;
    if (!id) {
      setBusy(false);
      return setError(tt("No authenticator app is set up.", "尚未设置身份验证器应用。"));
    }
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: id, code: code.trim() });
    setBusy(false);
    if (error) return setError(tt("That code didn't work. Check the app and try again.", "验证码不正确，请查看应用后重试。"));
    setCode("");
    onDone();
  };
  return (
    <form className="account-form code-prompt" onSubmit={(e) => void submit(e)}>
      {children}
      <Field label={tt("6-digit code from your authenticator app", "身份验证器应用中的 6 位验证码")} type="text" value={code} onChange={setCode} autoComplete="one-time-code" maxLength={6} autoFocus />
      <FormError text={error} />
      <button type="submit" className="primary" disabled={busy || code.trim().length !== 6}>
        {busy ? "…" : tt("Verify", "验证")}
      </button>
    </form>
  );
}

/** After signing in, an account with two-factor on is asked for its code before anything else. */
export function MfaGate() {
  const { tt } = useT();
  const account = useAccount();
  const [needed, setNeeded] = useState(false);
  const signedIn = account.state.status === "signedIn";
  useEffect(() => {
    if (!signedIn) return setNeeded(false);
    void account
      .client()
      .then(assurance)
      .then((a) => setNeeded(a.next === "aal2" && a.current !== "aal2"), () => {});
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!needed) return null;
  return (
    <div className="mfa-gate" role="dialog" aria-modal="true" aria-labelledby="h-mfa-gate">
      <div className="mfa-gate-box">
        <h2 id="h-mfa-gate">{tt("Two-factor sign-in", "两步验证")}</h2>
        <CodePrompt
          onDone={() => {
            setNeeded(false);
            void account.refresh();
          }}
        >
          <p>{tt("Your account has two-factor sign-in on. Enter the code from your authenticator app.", "你的账号已开启两步验证。请输入身份验证器应用中的验证码。")}</p>
        </CodePrompt>
        <p>
          <button type="button" className="link" onClick={() => void account.signOut()}>
            {tt("Sign out instead", "改为退出登录")}
          </button>
        </p>
      </div>
    </div>
  );
}

/** Settings → Account: turn two-factor sign-in on (scan a QR code, enter a code) or off. */
export function TwoFactorSection() {
  const { tt } = useT();
  const account = useAccount();
  const [factors, setFactors] = useState<{ id: string; status: string; friendly_name?: string | undefined }[] | null>(null);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const load = useCallback(async () => {
    const sb = await account.client();
    const { data } = await sb.auth.mfa.listFactors();
    setFactors(data?.all.filter((f) => f.factor_type === "totp") ?? []);
    setLevel((await assurance(sb)).current);
  }, [account]);
  useEffect(() => {
    void load();
  }, [load]);
  const verified = factors?.filter((f) => f.status === "verified") ?? [];

  const start = async () => {
    setError(null);
    const sb = await account.client();
    // An earlier, unfinished attempt is removed first.
    for (const f of factors?.filter((x) => x.status !== "verified") ?? []) await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
    if (error || !data) return setError(error ? authErrorText(error, tt) : null);
    setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };
  const remove = async (id: string) => {
    setError(null);
    const sb = await account.client();
    const { error } = await sb.auth.mfa.unenroll({ factorId: id });
    if (error) return setError(tt("To turn it off, sign in with your code first (sign out and in again).", "关闭前需先用验证码登录（请退出后重新登录）。"));
    setMessage(tt("Two-factor sign-in is off.", "两步验证已关闭。"));
    await load();
  };

  return (
    <section aria-labelledby="h-2fa">
      <h2 id="h-2fa">{tt("Two-factor sign-in", "两步验证")}</h2>
      <p className="muted">
        {tt(
          "With an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), signing in also needs a 6-digit code from your phone. Moderators must have it on. It also lets an email change happen at once.",
          "使用身份验证器应用（Google Authenticator、Microsoft Authenticator、1Password 等）后，登录还需输入手机上的 6 位验证码。管理员必须开启。开启后更改邮箱可以立即生效。",
        )}
      </p>
      {factors === null ? (
        <p className="muted">…</p>
      ) : verified.length > 0 ? (
        <>
          <p>
            <strong>{tt("On.", "已开启。")}</strong>{" "}
            {verified.map((f) => (
              <button key={f.id} type="button" disabled={level !== "aal2"} onClick={() => void remove(f.id)}>
                {tt("Turn off", "关闭")}
              </button>
            ))}
          </p>
          {level !== "aal2" && <p className="muted small">{tt("This session didn't use a code; sign in with your code to turn it off.", "本次登录未使用验证码；需用验证码登录后才能关闭。")}</p>}
        </>
      ) : enrolling ? (
        <div className="enroll-2fa">
          <p>{tt("1. Scan this with your authenticator app (or enter the key by hand).", "1. 用身份验证器应用扫描二维码（或手动输入密钥）。")}</p>
          <img src={enrolling.qr} alt={tt("QR code for your authenticator app", "身份验证器应用的二维码")} width={180} height={180} />
          <p className="small">
            {tt("Key:", "密钥：")} <code>{enrolling.secret}</code>
          </p>
          <CodePrompt
            factorId={enrolling.id}
            onDone={() => {
              setEnrolling(null);
              setMessage(tt("Two-factor sign-in is on. Keep your phone safe: without it you'll need the moderators' help to get back in.", "两步验证已开启。请保管好手机：没有它需要管理员协助才能登录。"));
              void load();
            }}
          >
            <p>{tt("2. Enter the code it shows.", "2. 输入应用显示的验证码。")}</p>
          </CodePrompt>
        </div>
      ) : (
        <button type="button" onClick={() => void start()}>
          {tt("Turn on two-factor sign-in", "开启两步验证")}
        </button>
      )}
      <FormError text={error} />
      {message && <p role="status">{message}</p>}
    </section>
  );
}

// "Confirm it's you" ---------------------------------------------------------------------------------

/** How recent a sign-in counts, in seconds (the database checks 10 minutes too). */
const RECENT = 10 * 60;

/**
 * Before a sensitive change: re-enter the password, or sign in again with Google, GitHub or
 * Microsoft (coming back to `returnTo`), plus a code with two-factor on. Already recent: at once.
 */
export function ConfirmItsYou({ hasPassword, provider, returnTo, onConfirmed }: { hasPassword: boolean; provider: Provider | undefined; returnTo: string; onConfirmed: () => void }) {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [step, setStep] = useState<"check" | "sign-in" | "code">("check");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const email = account.state.status === "signedIn" ? account.state.user.email : "";

  const check = useCallback(async () => {
    const a = await assurance(await account.client());
    const recent = Date.now() / 1000 - a.lastSignIn < RECENT;
    if (!recent) return setStep("sign-in");
    if (a.next === "aal2" && a.current !== "aal2") return setStep("code");
    onConfirmed();
  }, [account, onConfirmed]);
  useEffect(() => {
    void check();
  }, [check]);

  const withPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const sb = await account.client();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError(authErrorText(error, tt));
    setPassword("");
    await check();
  };
  const withProvider = async () => {
    if (!provider) return;
    rememberNext(returnTo);
    const sb = await account.client();
    await sb.auth.signInWithOAuth({ provider, options: { redirectTo: callbackUrl(nav.href), ...(provider === "azure" ? { scopes: "email" } : {}) } });
  };
  const providerName = PROVIDERS.find((p) => p.id === provider)?.name ?? "";

  if (step === "check") return <p className="muted">…</p>;
  if (step === "code") return <CodePrompt onDone={onConfirmed}>{<p>{tt("Confirm it's you: enter the code from your authenticator app.", "确认是你本人：请输入身份验证器应用中的验证码。")}</p>}</CodePrompt>;
  return (
    <div className="confirm-its-you">
      <p>
        <strong>{tt("Confirm it's you", "确认是你本人")}</strong>
      </p>
      {hasPassword ? (
        <form className="account-form" onSubmit={(e) => void withPassword(e)}>
          <Field label={tt("Your password", "你的密码")} type="password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus />
          <FormError text={error} />
          <button type="submit" className="primary" disabled={busy || !password}>
            {busy ? "…" : tt("Continue", "继续")}
          </button>
        </form>
      ) : provider ? (
        <button type="button" className="primary" onClick={() => void withProvider()}>
          {tt(`Sign in again with ${providerName}`, `重新使用 ${providerName} 登录`)}
        </button>
      ) : (
        <p className="muted">{tt("Sign out and sign in again, then come back here.", "请退出后重新登录，再回到这里。")}</p>
      )}
    </div>
  );
}

// Changing the email -----------------------------------------------------------------------------------

function useEmailHint() {
  const { tt } = useT();
  return (e: unknown) => {
    switch (e instanceof HintError ? e.hint : null) {
      case "reauth":
        return tt("Please confirm it's you again.", "请重新确认是你本人。");
      case "frozen":
        return tt("Email changes on this account are frozen until a moderator has looked at it. Use the Feedback page to reach them.", "此账号的邮箱更改已被冻结，需等待管理员处理。请通过“意见反馈”页面联系管理员。");
      case "locked":
        return tt("A recent change was denied from your old address, so changes are locked for a while.", "最近一次更改被旧邮箱拒绝，因此暂时锁定更改。");
      case "pending":
        return tt("A change is already under way.", "已有一项更改正在进行。");
      case "email":
        return tt("That isn't an email address.", "这不是有效的邮箱地址。");
      case "same":
        return tt("That's your email already.", "这已是你的邮箱。");
      case "taken":
        return tt("Another account uses that email.", "另一个账号正在使用该邮箱。");
      case "expired":
        return tt("This link has expired or was already used.", "此链接已过期或已使用。");
      default:
        return e instanceof Error ? e.message : String(e);
    }
  };
}

const fmtDate = (iso: string, lang: string) => new Date(iso).toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { year: "numeric", month: "long", day: "numeric" });

/** Settings → Account → Email: the open change (or a lock), or a new change after "Confirm it's you". */
export function EmailSection({ email, hasPassword, provider }: { email: string; hasPassword: boolean; provider: Provider | undefined }) {
  const { tt, lang } = useT();
  const nav = useNav();
  const account = useAccount();
  const hintText = useEmailHint();
  const [state, setState] = useState<MyEmailChange | null>(null);
  const [next, setNext] = useState("");
  const [confirming, setConfirming] = useState(nav.params().get("email") === "1");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    void account
      .client()
      .then(myEmailChange)
      .then(setState, () => {});
  }, [account]);
  useEffect(load, [load]);

  const start = useCallback(async () => {
    setError(null);
    try {
      await startEmailChange(await account.client(), next);
      setConfirming(false);
      setNext("");
      load();
    } catch (e) {
      setConfirming(false);
      setError(hintText(e));
    }
  }, [account, next, load, hintText]);
  const cancel = async () => {
    await cancelEmailChange(await account.client()).catch(() => {});
    load();
  };

  const c = state?.change;
  return (
    <section aria-labelledby="h-email">
      <h2 id="h-email">{tt("Email", "邮箱")}</h2>
      <p className="muted">{email}</p>
      {c ? (
        <div role="status">
          {c.status === "confirm-new" ? (
            <p>{tt(`We've sent a link to ${c.new}: open it to confirm the new address.`, `我们已向 ${c.new} 发送链接：请打开以确认新邮箱。`)}</p>
          ) : (
            <p>
              {tt(
                `Your email changes to ${c.new} on ${fmtDate(c.due_at!, lang)}, or sooner if you approve it from ${email}.`,
                `你的邮箱将于 ${fmtDate(c.due_at!, lang)} 改为 ${c.new}；如在 ${email} 中批准，则会更早生效。`,
              )}
            </p>
          )}
          <button type="button" onClick={() => void cancel()}>
            {tt("Cancel the change", "取消更改")}
          </button>
        </div>
      ) : state?.frozen ? (
        <p>{tt("Email changes are frozen until a moderator has looked at this account.", "邮箱更改已冻结，需等待管理员处理。")}</p>
      ) : state?.locked_until ? (
        <p>{tt(`A change was denied from your old address. Email changes are locked until ${fmtDate(state.locked_until, lang)}.`, `一次更改已被旧邮箱拒绝。邮箱更改锁定至 ${fmtDate(state.locked_until, lang)}。`)}</p>
      ) : confirming ? (
        <ConfirmItsYou hasPassword={hasPassword} provider={provider} returnTo={`/settings?tab=account&email=1`} onConfirmed={() => void start()} />
      ) : (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            setConfirming(true);
          }}
        >
          <Field label={tt("New email", "新邮箱")} type="email" value={next} onChange={setNext} autoComplete="email" />
          <p className="muted small">
            {tt(
              "We send a link to the new address. Then your current address can approve the change; if it can't (an old inbox you no longer have), the change happens by itself after 10 days. With two-factor sign-in on, it happens as soon as the new address is confirmed.",
              "我们会向新邮箱发送链接。然后你的当前邮箱可以批准更改；如果无法使用（例如已不再使用的旧邮箱），更改会在 10 天后自动生效。开启两步验证后，确认新邮箱即可立即生效。",
            )}
          </p>
          <FormError text={error} />
          <button type="submit" disabled={!next || next === email}>
            {tt("Change email", "修改邮箱")}
          </button>
        </form>
      )}
    </section>
  );
}

/** On every page while an email change waits: when it happens, and Cancel. */
export function EmailChangeBanner() {
  const { tt, lang } = useT();
  const account = useAccount();
  const [c, setC] = useState<MyEmailChange["change"]>(null);
  const signedIn = account.state.status === "signedIn";
  useEffect(() => {
    if (!signedIn) return setC(null);
    void account
      .client()
      .then(myEmailChange)
      .then((x) => setC(x.change?.status === "waiting" ? x.change : null), () => {});
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return null;
  const cancel = async () => {
    await cancelEmailChange(await account.client()).catch(() => {});
    setC(null);
  };
  return (
    <div className="update-banner email-change-banner" role="status">
      {tt(`Your account's email changes to ${c.new} on ${fmtDate(c.due_at!, lang)}.`, `你的账号邮箱将于 ${fmtDate(c.due_at!, lang)} 改为 ${c.new}。`)}{" "}
      <button type="button" className="link" onClick={() => void cancel()}>
        {tt("Wasn't you? Cancel it", "不是你？取消")}
      </button>
    </div>
  );
}

/** The page the email-change links open: confirm the new address, approve or deny from the old one, or undo. */
export function EmailChangePage() {
  const { tt, lang } = useT();
  const nav = useNav();
  const account = useAccount();
  const hintText = useEmailHint();
  const token = nav.params().get("t") ?? "";
  const [v, setV] = useState<EmailChangeView | null | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(() => {
    if (account.state.status === "loading" || account.state.status === "off") return;
    void account
      .client()
      .then((sb) => emailChangeView(sb, token))
      .then(setV, () => setV(null));
  }, [account, token]);
  useEffect(load, [load]);
  const act = async (f: (sb: SupabaseClient) => Promise<unknown>, done: string) => {
    setMessage(null);
    try {
      await f(await account.client());
      if (done) setMessage(done);
      load();
    } catch (e) {
      setMessage(hintText(e));
    }
  };

  if (v === undefined) return <p className="muted" style={{ padding: 24 }}>…</p>;
  const title = <h1>{tt("Email change", "更改邮箱")}</h1>;
  if (v === null || v.expired) {
    return (
      <div className="help email-change-page">
        {title}
        <p>{tt("This link has expired or isn't valid.", "此链接已过期或无效。")}</p>
      </div>
    );
  }
  return (
    <div className="help email-change-page">
      {title}
      {v.kind === "new" &&
        (v.status === "confirm-new" ? (
          <>
            <p>{tt(`Confirm ${v.new} as the email of the Xiangqi School account "${v.username}".`, `确认将 ${v.new} 设为象棋学堂账号"${v.username}"的邮箱。`)}</p>
            <button
              type="button"
              className="primary"
              onClick={() =>
                void act(
                  async (sb) => {
                    const r = await confirmNewEmail(sb, token);
                    setMessage(
                      r === "done"
                        ? tt("Done: this is now your account's email.", "完成：此邮箱现在是你的账号邮箱。")
                        : tt("Confirmed. We've asked your current address to approve; without an answer the change happens in 10 days.", "已确认。我们已请你的当前邮箱批准；如无回应，更改将在 10 天后生效。"),
                    );
                  },
                  "",
                )
              }
            >
              {tt("Confirm the new address", "确认新邮箱")}
            </button>
          </>
        ) : (
          <p>{tt("This address is confirmed.", "此邮箱已确认。")}</p>
        ))}
      {v.kind === "old" &&
        (v.status === "waiting" ? (
          <>
            <p>
              {tt(
                `Someone signed in to "${v.username}" asked to change its email from ${v.old} to ${v.new}. Without an answer it happens on ${fmtDate(v.due_at!, lang)}.`,
                `有人在已登录"${v.username}"的情况下申请将邮箱从 ${v.old} 改为 ${v.new}。如无回应，将于 ${fmtDate(v.due_at!, lang)} 生效。`,
              )}
            </p>
            <p className="guardian-actions">
              <button type="button" className="primary" onClick={() => void act((sb) => answerOldEmail(sb, token, true), tt("Approved: the email has changed.", "已批准：邮箱已更改。"))}>
                {tt("Approve", "批准")}
              </button>{" "}
              <button
                type="button"
                onClick={() =>
                  void act(
                    (sb) => answerOldEmail(sb, token, false),
                    tt("Denied. Every device is signed out; please sign in and set a new password.", "已拒绝。所有设备已退出登录；请登录并设置新密码。"),
                  )
                }
              >
                {tt("Deny: it wasn't me", "拒绝：不是我")}
              </button>
            </p>
          </>
        ) : (
          <p>{tt("This change is no longer waiting for an answer.", "此更改已不再等待回复。")}</p>
        ))}
      {v.kind === "undo" &&
        (v.status === "done" ? (
          <>
            <p>
              {tt(
                `The email of "${v.username}" was changed from ${v.old} to ${v.new}. If that wasn't you, this freezes email changes, signs out every device and asks a moderator to restore ${v.old}.`,
                `"${v.username}"的邮箱已从 ${v.old} 改为 ${v.new}。如果不是你本人操作，此操作将冻结邮箱更改、让所有设备退出登录，并请管理员恢复 ${v.old}。`,
              )}
            </p>
            <button
              type="button"
              onClick={() =>
                void act(
                  (sb) => undoEmailChange(sb, token),
                  tt("Done. A moderator will contact this address. Use the Feedback page if you need to add anything.", "已完成。管理员会联系此邮箱。如需补充，请使用“意见反馈”页面。"),
                )
              }
            >
              {tt("It wasn't me", "不是我")}
            </button>
          </>
        ) : (
          <p>{tt("A moderator is looking at this change.", "管理员正在处理此更改。")}</p>
        ))}
      {message && <p role="status">{message}</p>}
      <p className="muted small">
        <a href={nav.href("/")}>{tt("Xiangqi School home", "象棋学堂首页")}</a>
      </p>
    </div>
  );
}
