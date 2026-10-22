"use client";
// Account security (M23b, docs/v0.4-design.md): a second step (a passkey, an authenticator app,
// or a code by email) asked only before sensitive changes and for moderator work, never to sign
// in or play; "Confirm it's you" before those changes; and the site's
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

/**
 * Passkeys as a second factor. Off: Supabase's hosted projects refuse to enable WebAuthn for now
 * (2026-10-22). The rest of the code takes a passkey wherever one exists, so turning this on (and
 * the two mfa_web_authn settings in packages/db/scripts/apply.mjs) is all it takes later.
 */
const PASSKEYS = false;

type Factor = { id: string; factor_type: string; status: string; friendly_name?: string | undefined; created_at?: string };
/** The account's verified second factors: authenticator apps ("totp") and passkeys ("webauthn"). */
async function verifiedFactors(sb: SupabaseClient): Promise<Factor[]> {
  const { data } = await sb.auth.mfa.listFactors();
  return ((data?.all ?? []) as Factor[]).filter((f) => f.status === "verified" && (f.factor_type === "totp" || f.factor_type === "webauthn"));
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
    const id = factorId ?? (await verifiedFactors(sb)).find((f) => f.factor_type === "totp")?.id;
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

/** Uses a passkey (fingerprint, face or security key) and raises the session to two-factor. */
function PasskeyButton({ factorId, onDone }: { factorId: string; onDone: () => void }) {
  const { tt } = useT();
  const account = useAccount();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const use = async () => {
    setBusy(true);
    setError(null);
    const sb = await account.client();
    const { error } = await sb.auth.mfa.webauthn.authenticate({ factorId });
    setBusy(false);
    if (error) return setError(tt("The passkey didn't work. Try again, or use another way.", "通行密钥验证失败。请重试，或改用其他方式。"));
    onDone();
  };
  return (
    <p>
      <button type="button" className="primary" disabled={busy} onClick={() => void use()}>
        {busy ? "…" : tt("Use my passkey", "使用通行密钥")}
      </button>
      <FormError text={error} />
    </p>
  );
}

/** The second step with whatever the account has: a passkey button, an authenticator code, or both. */
export function SecondStep({ onDone, intro }: { onDone: () => void; intro: ReactNode }) {
  const { tt } = useT();
  const account = useAccount();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  useEffect(() => {
    void account
      .client()
      .then(verifiedFactors)
      .then(setFactors, () => setFactors([]));
  }, [account]);
  if (factors === null) return <p className="muted">…</p>;
  const passkey = factors.find((f) => f.factor_type === "webauthn");
  const app = factors.find((f) => f.factor_type === "totp");
  return (
    <div className="second-step">
      {intro}
      {passkey && <PasskeyButton factorId={passkey.id} onDone={onDone} />}
      {passkey && app && <p className="muted small">{tt("Or:", "或者：")}</p>}
      {app && <CodePrompt onDone={onDone} />}
    </div>
  );
}

/** The emailed code (sent on opening), for players who asked for one at sign-in. */
export function EmailCodePrompt({ onDone, intro }: { onDone: () => void; intro?: ReactNode }) {
  const { tt } = useT();
  const account = useAccount();
  const [to, setTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = useCallback(async () => {
    setError(null);
    try {
      const r = await rpc<{ needed: boolean; to?: string }>(await account.client(), "send_sign_in_code");
      if (!r.needed) return onDone();
      setTo(r.to ?? null);
    } catch (e) {
      const hint = e instanceof HintError ? e.hint : null;
      setError(
        hint === "wait"
          ? tt("A code was sent less than a minute ago: check your inbox (and junk folder).", "不到一分钟前已发送验证码：请查看收件箱（及垃圾邮件）。")
          : hint === "code-limit"
            ? tt("That's 10 codes today. Try again tomorrow, or use the Feedback page.", "今天已发送 10 个验证码。请明天再试，或通过“意见反馈”联系我们。")
            : e instanceof Error
              ? e.message
              : String(e),
      );
    }
  }, [account, onDone, tt]);
  useEffect(() => {
    void send();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ok = await rpc<boolean>(await account.client(), "verify_sign_in_code", { p_code: code.trim() });
      if (!ok) return setError(tt("That code isn't right.", "验证码不正确。"));
      onDone();
    } catch {
      setError(tt("That code has expired: send a new one.", "验证码已过期：请重新发送。"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="account-form code-prompt" onSubmit={(e) => void submit(e)}>
      {intro}
      <p>{to ? tt(`We've emailed a code to ${to}.`, `我们已向 ${to} 发送验证码。`) : tt("Sending a code to your email…", "正在向你的邮箱发送验证码…")}</p>
      <Field label={tt("6-digit code from the email", "邮件中的 6 位验证码")} type="text" value={code} onChange={setCode} autoComplete="one-time-code" maxLength={6} autoFocus />
      <FormError text={error} />
      <button type="submit" className="primary" disabled={busy || code.trim().length !== 6}>
        {busy ? "…" : tt("Verify", "验证")}
      </button>{" "}
      <button type="button" className="link" onClick={() => void send()}>
        {tt("Send a new code", "重新发送")}
      </button>
    </form>
  );
}

/**
 * Settings → Account → Account protection: passkeys, an authenticator app, and the emailed code,
 * each asked only before sensitive changes. The first two are two-factor (moderators need one).
 */
export function TwoFactorSection({ hasPassword, provider }: { hasPassword: boolean; provider: Provider | undefined }) {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [emailCode, setEmailCode] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState<boolean | null>(nav.params().get("signin") === "on" ? true : nav.params().get("signin") === "off" ? false : null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const load = useCallback(async () => {
    const sb = await account.client();
    const { data } = await sb.auth.mfa.listFactors();
    setFactors(((data?.all ?? []) as Factor[]).filter((f) => f.factor_type === "totp" || f.factor_type === "webauthn"));
    setLevel((await assurance(sb)).current);
    setEmailCode((await rpc<{ email_code: boolean }>(sb, "my_sign_in_check").catch(() => ({ email_code: false }))).email_code);
  }, [account]);
  useEffect(() => {
    void load();
  }, [load]);
  const verified = factors?.filter((f) => f.status === "verified") ?? [];
  const app = verified.find((f) => f.factor_type === "totp");
  const passkeys = verified.filter((f) => f.factor_type === "webauthn");

  const startApp = async () => {
    setError(null);
    const sb = await account.client();
    // An earlier, unfinished attempt is removed first.
    for (const f of factors?.filter((x) => x.status !== "verified") ?? []) await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
    if (error || !data) return setError(error ? authErrorText(error, tt) : null);
    setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };
  const addPasskey = async () => {
    setError(null);
    setMessage(null);
    const sb = await account.client();
    const { error } = await sb.auth.mfa.webauthn.register({ friendlyName: `Passkey ${new Date().toISOString().slice(0, 10)}` });
    if (error) return setError(tt("The passkey wasn't added. Try again, or use an authenticator app.", "未能添加通行密钥。请重试，或改用身份验证器应用。"));
    setMessage(tt("Passkey added: two-factor is on.", "已添加通行密钥：两步验证已开启。"));
    await load();
  };
  const remove = async (id: string) => {
    setError(null);
    const sb = await account.client();
    const { error } = await sb.auth.mfa.unenroll({ factorId: id });
    if (error) return setError(tt("Confirm with your passkey or code first.", "请先用通行密钥或验证码确认。"));
    setMessage(tt("Removed.", "已移除。"));
    await load();
  };
  const setEmail = useCallback(
    async (on: boolean) => {
      setError(null);
      try {
        await rpc(await account.client(), "set_email_code_sign_in", { p_on: on });
        setConfirming(null);
        setMessage(on ? tt("From now on, sensitive changes also ask for a code we email you.", "今后进行敏感更改时还需输入我们邮件发送的验证码。") : tt("Emailed codes are off.", "已关闭邮件验证码。"));
        await load();
      } catch (e) {
        setConfirming(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [account, load, tt],
  );
  // Removing one needs a two-factor session: ask for the passkey or code first.
  const [stepUp, setStepUp] = useState<string | null>(null);
  const removeButton = (f: Factor) => (
    <button type="button" onClick={() => (level === "aal2" ? void remove(f.id) : setStepUp(f.id))}>
      {tt("Remove", "移除")}
    </button>
  );

  return (
    <section aria-labelledby="h-2fa">
      <h2 id="h-2fa">{tt("Account protection", "账号保护")}</h2>
      <p className="muted">
        {tt(
          "Signing in and playing need only your password (or Google, GitHub, Microsoft). Before a sensitive change, such as your email or these settings, we also ask for a code from an authenticator app on your phone. Moderators must have one. It also lets an email change happen at once.",
          "登录和下棋只需密码（或 Google、GitHub、Microsoft）。进行敏感更改（如邮箱或这些设置）前，我们还会要求输入手机上身份验证器应用的验证码。管理员必须开启。开启后更改邮箱可以立即生效。",
        )}
      </p>
      {factors === null ? (
        <p className="muted">…</p>
      ) : (
        <>
          {(PASSKEYS || passkeys.length > 0) && <h3>{tt("Passkeys", "通行密钥")}</h3>}
          {passkeys.length > 0 && (
            <ul>
              {passkeys.map((f) => (
                <li key={f.id}>
                  {f.friendly_name ?? tt("Passkey", "通行密钥")} {removeButton(f)}
                </li>
              ))}
            </ul>
          )}
          {PASSKEYS && (
            <button type="button" onClick={() => void addPasskey()}>
              {tt("Add a passkey", "添加通行密钥")}
            </button>
          )}

          <h3>{tt("Authenticator app", "身份验证器应用")}</h3>
          {app ? (
            <p>
              <strong>{tt("On.", "已开启。")}</strong> {removeButton(app)}
            </p>
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
                  setMessage(tt("Two-factor is on. Keep your phone safe: without it, sensitive changes need the moderators' help.", "两步验证已开启。请保管好手机：没有它，敏感更改需要管理员协助。"));
                  void load();
                }}
              >
                <p>{tt("2. Enter the code it shows.", "2. 输入应用显示的验证码。")}</p>
              </CodePrompt>
            </div>
          ) : (
            <button type="button" onClick={() => void startApp()}>
              {tt("Set up an authenticator app", "设置身份验证器应用")}
            </button>
          )}
          {stepUp && (
            <SecondStep
              intro={<p>{tt("To remove it, confirm with your passkey or code.", "移除前请用通行密钥或验证码确认。")}</p>}
              onDone={() => {
                const id = stepUp;
                setStepUp(null);
                void remove(id);
              }}
            />
          )}

          <h3>{tt("Code by email", "邮件验证码")}</h3>
          <p className="muted small">
            {tt(
              "A simpler step: before a sensitive change we also email you a code. It stops someone who learned your password, but not someone who has your email too, so it doesn't count as two-factor.",
              "更简单的一步：进行敏感更改前，我们还会通过邮件发送验证码。它能阻止知道你密码的人，但不能阻止同时掌握你邮箱的人，因此不算两步验证。",
            )}
          </p>
          {confirming !== null ? (
            <ConfirmItsYou hasPassword={hasPassword} provider={provider} returnTo={`/settings?tab=account&signin=${confirming ? "on" : "off"}`} onConfirmed={() => void setEmail(confirming)} />
          ) : (
            <label className="inline">
              <input type="checkbox" checked={!!emailCode} onChange={(e) => setConfirming(e.target.checked)} /> {tt("Email me a code before sensitive changes", "敏感更改前通过邮件发送验证码")}
            </label>
          )}
        </>
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
 * Microsoft (coming back to `returnTo`), then the passkey or code with two-factor on, or the
 * emailed code when asked for. Already recent and complete: at once.
 */
export function ConfirmItsYou({ hasPassword, provider, returnTo, onConfirmed }: { hasPassword: boolean; provider: Provider | undefined; returnTo: string; onConfirmed: () => void }) {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [step, setStep] = useState<"check" | "sign-in" | "factor" | "email">("check");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const email = account.state.status === "signedIn" ? account.state.user.email : "";

  const check = useCallback(async () => {
    const sb = await account.client();
    const a = await assurance(sb);
    const recent = Date.now() / 1000 - a.lastSignIn < RECENT;
    if (!recent) return setStep("sign-in");
    if (a.next === "aal2" && a.current !== "aal2") return setStep("factor");
    const c = await rpc<{ needed: boolean }>(sb, "my_sign_in_check").catch(() => ({ needed: false }));
    if (c.needed) return setStep("email");
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
  const next = () => void check();

  if (step === "check") return <p className="muted">…</p>;
  if (step === "factor") return <SecondStep onDone={next} intro={<p>{tt("Confirm it's you with your passkey or code.", "请用通行密钥或验证码确认是你本人。")}</p>} />;
  if (step === "email") return <EmailCodePrompt onDone={onConfirmed} intro={<p>{tt("Confirm it's you with the code we email you.", "请用我们邮件发送的验证码确认是你本人。")}</p>} />;
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
