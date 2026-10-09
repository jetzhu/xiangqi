"use client";
// Sign up, log in, reset password, and the page links in our emails open (/auth/callback/).
// Email sign-ups stay guests until they click the link in the confirmation email.

import { type FormEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNav } from "../nav.js";
import { COUNTRIES } from "./avatar.js";
import { ageChecked, markAgeChecked, minAgeFor, oldEnough } from "./age.js";
import { useT } from "../settings.js";
import { type Account, PROVIDERS, type Provider, useAccount } from "./session.js";

export const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,18}[A-Za-z0-9]$/;
export const MIN_PASSWORD = 8;
const RESEND_SECONDS = 60;

export type UsernameProblem = "format" | "digits" | "reserved" | "taken";

/** The checks the database repeats (public.username_problem) that need no network. */
export function usernameFormatProblem(name: string): UsernameProblem | null {
  if (!USERNAME_PATTERN.test(name)) return "format";
  if (/^[0-9]+$/.test(name)) return "digits";
  return null;
}

type TT = (en: string, zh: string) => string;

const usernameText = (p: UsernameProblem, tt: TT) =>
  ({
    format: tt("3–20 letters, digits, _ or -, starting and ending with a letter or digit.", "3–20 个字母、数字、_ 或 -，首尾须为字母或数字。"),
    digits: tt("A username can't be only digits.", "用户名不能全是数字。"),
    reserved: tt("This name is reserved. Please choose another.", "该名称已被保留，请换一个。"),
    taken: tt("This username is taken.", "该用户名已被使用。"),
  })[p];

/** A Supabase auth error in words a player understands. */
export function authErrorText(e: { code?: string | undefined; message?: string; status?: number | undefined }, tt: TT): string {
  switch (e.code) {
    case "invalid_credentials":
      return tt("Wrong email or password.", "邮箱或密码不正确。");
    case "email_not_confirmed":
      return tt("Please confirm your email first: click the link we sent you.", "请先确认邮箱：点击我们发给你的邮件中的链接。");
    case "weak_password":
      return tt(`Choose a stronger password: at least ${MIN_PASSWORD} characters, not a common one.`, `请换一个更安全的密码：至少 ${MIN_PASSWORD} 位，且不要用常见密码。`);
    case "email_address_invalid":
      return tt("That email address doesn't look right.", "邮箱地址格式不正确。");
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return tt("Too many tries. Please wait a minute and try again.", "尝试次数太多，请稍等一分钟再试。");
    case "user_already_exists":
    case "email_exists":
      return tt("There's already an account with this email. Log in instead.", "该邮箱已注册，请直接登录。");
    case "same_password":
      return tt("The new password must be different from the old one.", "新密码不能与旧密码相同。");
    case "otp_expired":
      return tt("This link has expired or was already used.", "该链接已过期或已被使用。");
    case "signup_disabled":
      return tt("Sign-up is closed for now.", "暂不开放注册。");
    case "access_denied":
      return tt("Sign-in was cancelled.", "登录已取消。");
    case "identity_already_exists":
      return tt("That account is already connected to another Xiangqi School account.", "该账号已关联到另一个象棋学堂账号。");
    case "single_identity_not_deletable":
      return tt("This is your only way to sign in, so it can't be removed.", "这是你唯一的登录方式，不能移除。");
    case "manual_linking_disabled":
    case "provider_disabled":
      return tt("This sign-in method isn't available right now.", "该登录方式暂不可用。");
  }
  if (e.status === 0 || /fetch|network/i.test(e.message ?? "")) return tt("Can't reach the server. Check your connection and try again.", "无法连接服务器，请检查网络后重试。");
  if (/Database error saving new user/i.test(e.message ?? "")) return tt("That username was just taken. Please choose another.", "该用户名刚被占用，请换一个。");
  return tt("Something went wrong. Please try again.", "出了点问题，请重试。");
}

/** Absolute address of the page our email links open, in the current language. */
export function callbackUrl(href: (p: string) => string): string {
  return new URL(href("/auth/callback"), location.href).toString();
}

/** A same-site path to return to after logging in ("/bots"), or "/" for anything else. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}

const NEXT_KEY = "xq:auth-next";

/** Remembers where to go after a sign-in that leaves the site (Google, Microsoft, GitHub). */
export function rememberNext(next: string) {
  try {
    sessionStorage.setItem(NEXT_KEY, safeNext(next));
  } catch {}
}
function takeNext(): string | null {
  try {
    const next = sessionStorage.getItem(NEXT_KEY);
    sessionStorage.removeItem(NEXT_KEY);
    return next;
  } catch {
    return null;
  }
}

/** A username built from a provider's name or email: "Carol Example" → "Carol_Example". */
export function suggestUsername(...sources: (string | undefined)[]): string {
  for (const source of sources) {
    if (!source) continue;
    let name = source
      .split("@")[0]!
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9_-]/g, "")
      .replace(/^[_-]+|[_-]+$/g, "")
      .slice(0, 20)
      .replace(/[_-]+$/, "");
    if (/^[0-9]+$/.test(name)) name = `p${name}`.slice(0, 20);
    if (!usernameFormatProblem(name)) return name;
  }
  return "";
}

/** Checks a username as it is typed: format here, reserved or taken on the server. */
function useUsernameProblem(account: Account, username: string, ownId?: string): [UsernameProblem | null, (p: UsernameProblem | null) => void] {
  const [problem, setProblem] = useState<UsernameProblem | null>(null);
  useEffect(() => {
    setProblem(null);
    if (!username) return;
    const local = usernameFormatProblem(username);
    const t = setTimeout(
      () => {
        if (local) return setProblem(local);
        void account
          .client()
          .then((sb) => sb.rpc("username_problem", ownId ? { name: username, for_user: ownId } : { name: username }))
          .then(({ data }) => setProblem((data as UsernameProblem | null) ?? null))
          .catch(() => {});
      },
      local ? 600 : 350,
    );
    return () => clearTimeout(t);
  }, [username, account.client, ownId]); // eslint-disable-line react-hooks/exhaustive-deps
  return [problem, setProblem];
}

/** "Continue with Google / Microsoft / GitHub", for the providers switched on in Supabase. */
function ProviderButtons({ next }: { next: string }) {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void account.providers().then(setProviders);
  }, [account.providers]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!providers.length) return null;
  const go = async (provider: Provider) => {
    setError(null);
    rememberNext(next);
    const sb = await account.client();
    // A full-page redirect: pop-ups can't talk back to a cross-origin-isolated page.
    const { error } = await sb.auth.signInWithOAuth({
      provider,
      options: provider === "azure" ? { redirectTo: callbackUrl(nav.href), scopes: "email" } : { redirectTo: callbackUrl(nav.href) },
    });
    if (error) setError(authErrorText(error, tt));
  };
  return (
    <div className="providers">
      {PROVIDERS.filter((p) => providers.includes(p.id)).map((p) => (
        <button key={p.id} type="button" className={`provider provider-${p.id}`} onClick={() => void go(p.id)}>
          {tt(`Continue with ${p.name}`, `使用 ${p.name} 继续`)}
        </button>
      ))}
      <FormError text={error} />
      <p className="or" aria-hidden>
        <span>{tt("or with email", "或使用邮箱")}</span>
      </p>
    </div>
  );
}

function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth">
      <div className="panel">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function Field(props: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  hint?: string | null;
  error?: string | null;
  minLength?: number;
  maxLength?: number;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const { tt } = useT();
  const password = props.type === "password";
  const note = props.error ?? props.hint;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <div className="field-input">
        <input
          id={id}
          type={password && show ? "text" : props.type}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          autoComplete={props.autoComplete}
          required
          minLength={props.minLength}
          maxLength={props.maxLength}
          autoFocus={props.autoFocus}
          spellCheck={false}
          autoCapitalize="none"
          aria-invalid={props.error ? true : undefined}
          aria-describedby={note ? `${id}-note` : undefined}
        />
        {password && (
          <button type="button" className="link-button" onClick={() => setShow(!show)} aria-pressed={show}>
            {show ? tt("Hide", "隐藏") : tt("Show", "显示")}
          </button>
        )}
      </div>
      {note && (
        <p id={`${id}-note`} className={props.error ? "field-error" : "muted field-hint"}>
          {note}
        </p>
      )}
    </div>
  );
}

export function FormError({ text }: { text: string | null }) {
  return text ? (
    <p className="form-error" role="alert">
      {text}
    </p>
  ) : null;
}

/** Shown while accounts are off (no backend in this build) or the library is loading. */
function Unavailable() {
  const { tt } = useT();
  return (
    <AuthShell title={tt("Accounts", "账号")}>
      <p className="muted">{tt("Accounts aren't available on this version of the site.", "此版本网站暂不支持账号。")}</p>
    </AuthShell>
  );
}

/** Seconds left before another email may be sent; counts down once started. */
function useCooldown(): [number, () => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, () => setLeft(RESEND_SECONDS)];
}

function CheckEmail({ email, kind }: { email: string; kind: "signup" | "reset" }) {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [left, start] = useCooldown();
  const [note, setNote] = useState<string | null>(null);
  useEffect(start, []); // eslint-disable-line react-hooks/exhaustive-deps
  const resend = async () => {
    const sb = await account.client();
    const { error } =
      kind === "signup"
        ? await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: callbackUrl(nav.href) } })
        : await sb.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl(nav.href) });
    setNote(error ? authErrorText(error, tt) : tt("Sent again.", "已重新发送。"));
    start();
  };
  return (
    <div className="check-email" role="status">
      <p>
        {kind === "signup"
          ? tt(`We sent a link to ${email}. Click it to finish signing up.`, `我们已向 ${email} 发送了一封邮件，点击其中的链接即可完成注册。`)
          : tt(`If there's an account for ${email}, we've sent it a link to choose a new password.`, `如果 ${email} 已注册，我们已向它发送了重设密码的链接。`)}
      </p>
      <p className="muted">{tt("The link works for one hour. Check your spam folder if it doesn't arrive.", "链接一小时内有效。如果没有收到，请查看垃圾邮件。")}</p>
      <p className="buttons">
        <button type="button" onClick={() => void resend()} disabled={left > 0}>
          {left > 0 ? tt(`Send again in ${left} s`, `${left} 秒后可重新发送`) : tt("Send again", "重新发送")}
        </button>
      </p>
      {note && <p className="muted">{note}</p>}
    </div>
  );
}

export function SignUpPage() {
  const { tt, lang } = useT();
  const nav = useNav();
  const account = useAccount();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useUsernameProblem(account, username);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [age, setAge] = useState<"ask" | "ok" | number>("ask");
  useEffect(() => setAge(ageChecked() ? "ok" : "ask"), []);

  if (account.state.status === "off") return <Unavailable />;
  if (account.state.status === "signedIn") return <SignedInAlready />;
  if (age !== "ok")
    return (
      <AuthShell title={tt("Create your account", "注册账号")}>
        {typeof age === "number" ? <TooYoung min={age} /> : <AgeGate onPass={() => setAge("ok")} onFail={setAge} />}
      </AuthShell>
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local = usernameFormatProblem(username);
    if (local || problem) return setProblem(local ?? problem);
    setBusy(true);
    setError(null);
    try {
      const sb = await account.client();
      const { error } = await sb.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: callbackUrl(nav.href), data: { username, lang } },
      });
      if (error) setError(authErrorText(error, tt));
      else setSent(email.trim());
    } catch (err) {
      setError(authErrorText(err as Error, tt));
    }
    setBusy(false);
  };

  if (sent)
    return (
      <AuthShell title={tt("Check your email", "请查收邮件")}>
        <CheckEmail email={sent} kind="signup" />
      </AuthShell>
    );

  return (
    <AuthShell title={tt("Create your account", "注册账号")}>
      <p className="muted">
        {tt(
          "Free. An account keeps your progress, ratings and games on every device. What you've done in this browser moves into it when you sign in.",
          "免费注册。账号会在所有设备上保存你的进度、等级分和对局。登录后，你在本浏览器中的进度会转入账号。",
        )}
      </p>
      <ProviderButtons next="/" />
      <form onSubmit={(e) => void submit(e)} noValidate={false}>
        <Field
          label={tt("Username", "用户名")}
          type="text"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          minLength={3}
          maxLength={20}
          autoFocus
          error={problem ? usernameText(problem, tt) : null}
          hint={tt("Shown to other players later. Please don't use your real name.", "以后会显示给其他棋友。请不要使用真实姓名。")}
        />
        <Field label={tt("Email", "邮箱")} type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          label={tt("Password", "密码")}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          hint={tt(`At least ${MIN_PASSWORD} characters.`, `至少 ${MIN_PASSWORD} 位。`)}
        />
        <FormError text={error} />
        <p className="muted field-aside">
          {tt("By signing up you agree to the ", "注册即表示你同意")}
          <a href={nav.href("/terms")}>{tt("terms of use", "使用条款")}</a>
          {tt(" and the ", "和")}
          <a href={nav.href("/privacy")}>{tt("privacy policy", "隐私政策")}</a>
          {tt(".", "。")}
        </p>
        <button type="submit" className="primary wide" disabled={busy}>
          {busy ? "…" : tt("Sign up", "注册")}
        </button>
      </form>
      <p className="auth-alt">
        {tt("Already have an account?", "已有账号？")} <a href={nav.href("/login")}>{tt("Log in", "登录")}</a>
      </p>
    </AuthShell>
  );
}

function SignedInAlready() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const name = account.state.status === "signedIn" ? account.state.user.username : "";
  return (
    <AuthShell title={tt("You're signed in", "你已登录")}>
      <p>{tt(`Signed in as ${name}.`, `当前账号：${name}。`)}</p>
      <p className="buttons">
        <a className="button primary" href={nav.href("/")}>
          {tt("Go to home", "回到首页")}
        </a>
        <button type="button" onClick={() => void account.signOut()}>
          {tt("Sign out", "退出登录")}
        </button>
      </p>
    </AuthShell>
  );
}

export function LogInPage() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (account.state.status === "off") return <Unavailable />;
  if (account.state.status === "signedIn" && !busy) return <SignedInAlready />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnconfirmed(false);
    try {
      const sb = await account.client();
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setError(authErrorText(error, tt));
        setUnconfirmed(error.code === "email_not_confirmed");
        setBusy(false);
        return;
      }
      await account.refresh();
      location.assign(nav.href(safeNext(nav.params().get("next"))));
    } catch (err) {
      setError(authErrorText(err as Error, tt));
      setBusy(false);
    }
  };

  if (sent)
    return (
      <AuthShell title={tt("Check your email", "请查收邮件")}>
        <CheckEmail email={email.trim()} kind="signup" />
      </AuthShell>
    );

  return (
    <AuthShell title={tt("Log in", "登录")}>
      <ProviderButtons next={safeNext(nav.params().get("next"))} />
      <form onSubmit={(e) => void submit(e)}>
        <Field label={tt("Email", "邮箱")} type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
        <Field label={tt("Password", "密码")} type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <p className="field-aside">
          <a href={nav.href("/reset-password")}>{tt("Forgot your password?", "忘记密码？")}</a>
        </p>
        <FormError text={error} />
        {unconfirmed && (
          <p>
            <button
              type="button"
              onClick={() =>
                void account
                  .client()
                  .then((sb) => sb.auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: callbackUrl(nav.href) } }))
                  .then(() => setSent(true))
              }
            >
              {tt("Send the confirmation email again", "重新发送确认邮件")}
            </button>
          </p>
        )}
        <button type="submit" className="primary wide" disabled={busy}>
          {busy ? "…" : tt("Log in", "登录")}
        </button>
      </form>
      <p className="auth-alt">
        {tt("New here?", "还没有账号？")} <a href={nav.href("/signup")}>{tt("Create an account", "注册")}</a>
      </p>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (account.state.status === "off") return <Unavailable />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const sb = await account.client();
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: callbackUrl(nav.href) });
      if (error) setError(authErrorText(error, tt));
      else setSent(true);
    } catch (err) {
      setError(authErrorText(err as Error, tt));
    }
    setBusy(false);
  };

  return (
    <AuthShell title={tt("Reset your password", "重设密码")}>
      {sent ? (
        <CheckEmail email={email.trim()} kind="reset" />
      ) : (
        <>
          <p className="muted">{tt("Enter your account's email and we'll send you a link to choose a new password.", "输入账号邮箱，我们会发送一个设置新密码的链接。")}</p>
          <form onSubmit={(e) => void submit(e)}>
            <Field label={tt("Email", "邮箱")} type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
            <FormError text={error} />
            <button type="submit" className="primary wide" disabled={busy}>
              {busy ? "…" : tt("Send link", "发送链接")}
            </button>
          </form>
        </>
      )}
      <p className="auth-alt">
        <a href={nav.href("/login")}>{tt("Back to log in", "返回登录")}</a>
      </p>
    </AuthShell>
  );
}

function NewPasswordForm({ onDone }: { onDone: () => void }) {
  const { tt } = useT();
  const account = useAccount();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const sb = await account.client();
    const { error } = await sb.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(authErrorText(error, tt));
    else onDone();
  };
  return (
    <form onSubmit={(e) => void submit(e)}>
      <Field
        label={tt("New password", "新密码")}
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        minLength={MIN_PASSWORD}
        autoFocus
        hint={tt(`At least ${MIN_PASSWORD} characters.`, `至少 ${MIN_PASSWORD} 位。`)}
      />
      <FormError text={error} />
      <button type="submit" className="primary wide" disabled={busy}>
        {busy ? "…" : tt("Save new password", "保存新密码")}
      </button>
    </form>
  );
}

type CallbackStep = { kind: "working" } | { kind: "confirmed" } | { kind: "signedIn" } | { kind: "chooseUsername" } | { kind: "otherBrowser" } | { kind: "newPassword" } | { kind: "passwordSaved" } | { kind: "failed"; message: string };

/** Where links in our emails land: confirms the email, or lets the player choose a new password. */
export function AuthCallbackPage() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [step, setStep] = useState<CallbackStep>({ kind: "working" });
  const started = useRef(false);

  useEffect(() => {
    if (account.state.status === "off" || started.current) return;
    started.current = true;
    const query = nav.params();
    const hash = new URLSearchParams(location.hash.slice(1));
    // Email links put errors in the hash; Google, Microsoft and GitHub in the query.
    const errorCode = query.get("error_code") ?? hash.get("error_code") ?? query.get("error") ?? hash.get("error");
    const tokenHash = query.get("token_hash");
    const type = query.get("type");
    const code = query.get("code");
    // The token can be used once: drop it from the address bar so a reload doesn't retry it.
    nav.replace("/auth/callback");
    void (async () => {
      if (errorCode) return setStep({ kind: "failed", message: authErrorText({ code: errorCode }, tt) });
      const sb = await account.client();
      if (tokenHash && type) {
        const otpType = type === "signup" ? "email" : (type as "recovery" | "email_change" | "email" | "magiclink");
        const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
        if (error) return setStep({ kind: "failed", message: authErrorText(error, tt) });
        await account.refresh();
        setStep(otpType === "recovery" ? { kind: "newPassword" } : { kind: "confirmed" });
      } else if (code) {
        // Supabase's default emails, and Google/Apple/GitHub sign-in (M10), come back with a
        // code that only the browser which asked for it can use.
        const { data, error } = await sb.auth.exchangeCodeForSession(code);
        if (error?.code === "pkce_code_verifier_not_found") return setStep({ kind: "otherBrowser" });
        if (error) return setStep({ kind: "failed", message: authErrorText(error, tt) });
        const state = await account.refresh();
        // redirectType is returned at runtime but missing from the published types.
        if ((data as { redirectType?: string | null }).redirectType === "recovery") return setStep({ kind: "newPassword" });
        const provider = data.user?.app_metadata.provider;
        if (state.status === "signedIn" && !state.user.usernameChosen) return setStep({ kind: "chooseUsername" });
        const next = takeNext();
        if (next) return location.assign(nav.href(next));
        setStep(provider && provider !== "email" ? { kind: "signedIn" } : { kind: "confirmed" });
      } else {
        setStep({ kind: "failed", message: tt("This link is incomplete. Open it again from the email.", "链接不完整，请从邮件中重新打开。") });
      }
    })().catch((e: unknown) => setStep({ kind: "failed", message: authErrorText(e as Error, tt) }));
  }, [account, nav, tt]);

  if (account.state.status === "off") return <Unavailable />;
  const name = account.state.status === "signedIn" ? account.state.user.username : "";

  switch (step.kind) {
    case "working":
      return (
        <AuthShell title={tt("One moment…", "请稍候…")}>
          <p className="muted" role="status">
            {tt("Checking your link.", "正在验证链接。")}
          </p>
        </AuthShell>
      );
    case "confirmed":
      return (
        <AuthShell title={tt("You're in", "注册成功")}>
          <p role="status">{tt(`Your email is confirmed and you're signed in as ${name}.`, `邮箱已确认，你已登录为 ${name}。`)}</p>
          <p className="buttons">
            <a className="button primary" href={nav.href("/")}>
              {tt("Go to home", "回到首页")}
            </a>
            <a className="button" href={nav.href("/learn")}>
              {tt("Start learning", "开始学习")}
            </a>
          </p>
        </AuthShell>
      );
    case "signedIn":
      return (
        <AuthShell title={tt("You're in", "已登录")}>
          <p role="status">{tt(`You're signed in as ${name}.`, `你已登录为 ${name}。`)}</p>
          <p className="buttons">
            <a className="button primary" href={nav.href("/")}>
              {tt("Go to home", "回到首页")}
            </a>
          </p>
        </AuthShell>
      );
    case "chooseUsername":
      return (
        <AuthShell title={tt("Choose your username", "选择用户名")}>
          <ChooseUsername
            onDone={() => {
              const next = takeNext();
              if (next) location.assign(nav.href(next));
              else setStep({ kind: "signedIn" });
            }}
          />
        </AuthShell>
      );
    case "otherBrowser":
      return (
        <AuthShell title={tt("Open the link in the same browser", "请在同一浏览器中打开链接")}>
          <p role="status">
            {tt(
              "This link was opened in a different browser from the one you used on the site. If you were confirming your email, it is confirmed: log in here to continue.",
              "这个链接是在另一个浏览器中打开的。如果你是在确认邮箱，邮箱已经确认，请在这里登录即可。",
            )}
          </p>
          <p className="muted">
            {tt("If you were resetting your password, ask for a new link from this browser.", "如果你是在重设密码，请在这个浏览器中重新获取链接。")}
          </p>
          <p className="buttons">
            <a className="button primary" href={nav.href("/login")}>
              {tt("Log in", "登录")}
            </a>
            <a className="button" href={nav.href("/reset-password")}>
              {tt("Reset password", "重设密码")}
            </a>
          </p>
        </AuthShell>
      );
    case "newPassword":
      return (
        <AuthShell title={tt("Choose a new password", "设置新密码")}>
          <NewPasswordForm onDone={() => setStep({ kind: "passwordSaved" })} />
        </AuthShell>
      );
    case "passwordSaved":
      return (
        <AuthShell title={tt("Password saved", "密码已保存")}>
          <p role="status">{tt(`Your new password is saved and you're signed in as ${name}.`, `新密码已保存，你已登录为 ${name}。`)}</p>
          <p className="buttons">
            <a className="button primary" href={nav.href("/")}>
              {tt("Go to home", "回到首页")}
            </a>
          </p>
        </AuthShell>
      );
    case "failed":
      return (
        <AuthShell title={tt("That link didn't work", "链接无效")}>
          <p className="form-error" role="alert">
            {step.message}
          </p>
          <p className="muted">{tt("Log in, or ask for a new link from the log-in page.", "请直接登录，或在登录页重新获取链接。")}</p>
          <p className="buttons">
            <a className="button primary" href={nav.href("/login")}>
              {tt("Log in", "登录")}
            </a>
            <a className="button" href={nav.href("/reset-password")}>
              {tt("Reset password", "重设密码")}
            </a>
          </p>
        </AuthShell>
      );
  }
}

/** Once, after a first Google/Microsoft/GitHub sign-in: swap the placeholder name for a real one. */
function ChooseUsername({ onDone }: { onDone: () => void }) {
  const [age, setAge] = useState<"ask" | "ok" | number>(() => (ageChecked() ? "ok" : "ask"));
  const account = useAccount();
  if (typeof age === "number") return <TooYoung min={age} />;
  if (age === "ask")
    return (
      <AgeGate
        onPass={() => setAge("ok")}
        onFail={(min) => {
          setAge(min);
          // The account was made a moment ago by the provider sign-in: remove it, sign out.
          void account
            .client()
            .then((sb) => sb.rpc("delete_new_account"))
            .finally(() => void account.signOut());
        }}
      />
    );
  return <ChooseName onDone={onDone} />;
}

function ChooseName({ onDone }: { onDone: () => void }) {
  const { tt } = useT();
  const account = useAccount();
  const user = account.state.status === "signedIn" ? account.state.user : null;
  const [username, setUsername] = useState("");
  const [problem, setProblem] = useUsernameProblem(account, username, user?.id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Suggest a name from the provider's profile, made unique if needed.
  useEffect(() => {
    void (async () => {
      const sb = await account.client();
      const meta = (await sb.auth.getUser()).data.user?.user_metadata ?? {};
      const base = suggestUsername(meta.user_name, meta.preferred_username, meta.full_name, meta.name, meta.email);
      if (!base) return;
      for (const candidate of [base, ...[1, 2, 3].map(() => `${base.slice(0, 16)}${Math.floor(100 + Math.random() * 900)}`)]) {
        const { data } = await sb.rpc("username_problem", { name: candidate, for_user: user?.id });
        if (data === null) return setUsername((current) => current || candidate);
      }
    })().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local = usernameFormatProblem(username);
    if (local || problem) return setProblem(local ?? problem);
    setBusy(true);
    setError(null);
    const sb = await account.client();
    const { error } = await sb.from("profiles").update({ username }).eq("user_id", user.id);
    setBusy(false);
    if (error) {
      const hint = error.hint as UsernameProblem | "too_soon" | null;
      if (hint && hint !== "too_soon") return setProblem(hint);
      return setError(authErrorText(error, tt));
    }
    await account.refresh();
    onDone();
  };
  return (
    <>
      <p className="muted">
        {tt(
          `You're signed in. Pick the name other players will see; for now you're ${user.username}.`,
          `你已登录。请选择其他棋友看到的名字，目前是 ${user.username}。`,
        )}
      </p>
      <form onSubmit={(e) => void submit(e)}>
        <Field
          label={tt("Username", "用户名")}
          type="text"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          minLength={3}
          maxLength={20}
          autoFocus
          error={problem ? usernameText(problem, tt) : null}
          hint={tt("3–20 letters, digits, _ or -. Please don't use your real name.", "3–20 个字母、数字、_ 或 -。请不要使用真实姓名。")}
        />
        <FormError text={error} />
        <button type="submit" className="primary wide" disabled={busy || !username}>
          {busy ? "…" : tt("Save username", "保存用户名")}
        </button>
      </form>
      <p className="auth-alt">
        <button type="button" className="link-button" onClick={onDone}>
          {tt("Skip for now", "暂时跳过")}
        </button>
      </p>
    </>
  );
}

/** Changing the username later (on the profile page): once every 90 days, as the database allows. */
export function ChangeUsername() {
  const { tt } = useT();
  const account = useAccount();
  const user = account.state.status === "signedIn" ? account.state.user : null;
  const [username, setUsername] = useState(user?.username ?? "");
  const [problem, setProblem] = useUsernameProblem(account, username === user?.username ? "" : username, user?.id);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (username === user.username) return;
    const local = usernameFormatProblem(username);
    if (local || problem) return setProblem(local ?? problem);
    setBusy(true);
    setError(null);
    setDone(false);
    const sb = await account.client();
    const { error } = await sb.from("profiles").update({ username }).eq("user_id", user.id);
    setBusy(false);
    if (error) {
      const hint = error.hint as UsernameProblem | "too_soon" | null;
      if (hint === "too_soon" || /90 days/.test(error.message)) return setError(tt("You can change your username once every 90 days.", "用户名每 90 天只能修改一次。"));
      if (hint) return setProblem(hint);
      return setError(authErrorText(error, tt));
    }
    await account.refresh();
    setDone(true);
  };
  return (
    <form className="change-username" onSubmit={(e) => void submit(e)}>
      <Field
        label={tt("Username", "用户名")}
        type="text"
        value={username}
        onChange={(v) => {
          setUsername(v);
          setDone(false);
        }}
        autoComplete="username"
        minLength={3}
        maxLength={20}
        error={problem ? usernameText(problem, tt) : null}
        hint={tt("Once every 90 days. Please don't use your real name.", "每 90 天可修改一次。请不要使用真实姓名。")}
      />
      <FormError text={error} />
      {done && <p className="form-ok">{tt("Username changed.", "用户名已修改。")}</p>}
      <button type="submit" disabled={busy || !username || username === user.username}>
        {busy ? "…" : tt("Change username", "修改用户名")}
      </button>
    </form>
  );
}

/**
 * Before an account is made: birth month, year and country, against chess.com's minimum ages
 * (account/age.ts). Nothing is stored; under the age, the visitor stays a guest.
 */
export function AgeGate({ onPass, onFail }: { onPass: () => void; onFail: (minAge: number) => void }) {
  const { tt, lang } = useT();
  const now = new Date().getFullYear();
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [country, setCountry] = useState("");
  const locale = lang === "zh" ? "zh-CN" : "en";
  const names = useMemo(() => {
    try {
      const d = new Intl.DisplayNames([locale], { type: "region" });
      return (c: string) => d.of(c) ?? c;
    } catch {
      return (c: string) => c;
    }
  }, [locale]);
  const countries = useMemo(() => [...COUNTRIES].sort((a, b) => names(a).localeCompare(names(b), locale)), [names, locale]);
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(locale, { month: "long" })), [locale]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (oldEnough(Number(year), Number(month), country)) {
      markAgeChecked();
      onPass();
    } else onFail(minAgeFor(country));
  };
  return (
    <form className="age-gate" onSubmit={submit}>
      <p className="muted">{tt("First, so we follow the rules for young players where you live:", "首先，为了遵守你所在地区关于未成年人的规定：")}</p>
      <fieldset>
        <legend>{tt("Your birthday", "你的出生年月")}</legend>
        <select aria-label={tt("Month", "月")} value={month} onChange={(e) => setMonth(e.target.value)} required>
          <option value="">{tt("Month", "月")}</option>
          {months.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select aria-label={tt("Year", "年")} value={year} onChange={(e) => setYear(e.target.value)} required>
          <option value="">{tt("Year", "年")}</option>
          {Array.from({ length: 100 }, (_, i) => now - i).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </fieldset>
      <label>
        {tt("Country or region", "国家或地区")}
        <select value={country} onChange={(e) => setCountry(e.target.value)} required>
          <option value="" />
          {countries.map((c) => (
            <option key={c} value={c}>
              {names(c)}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">{tt("We don't keep your answer.", "我们不会保存你的回答。")}</p>
      <button type="submit" className="primary wide" disabled={!year || !month || !country}>
        {tt("Continue", "继续")}
      </button>
    </form>
  );
}

/** Under the minimum age: no account, but everything works as a guest. */
export function TooYoung({ min }: { min: number }) {
  const { tt } = useT();
  const nav = useNav();
  return (
    <div role="status">
      <p>
        {tt(
          `You need to be ${min} or older to create an account where you live.`,
          `在你所在的地区，年满 ${min} 岁才能注册账号。`,
        )}
      </p>
      <p>
        {tt(
          "You can still use everything on the site: lessons, puzzles, bots and analysis. Your progress is kept in this browser.",
          "你仍然可以使用网站的全部功能：课程、题目、人机对弈和分析。你的进度保存在本浏览器中。",
        )}
      </p>
      <p className="buttons">
        <a className="button primary" href={nav.href("/learn")}>
          {tt("Start learning", "开始学习")}
        </a>
      </p>
    </div>
  );
}
