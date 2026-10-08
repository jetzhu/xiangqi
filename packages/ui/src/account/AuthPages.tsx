"use client";
// Sign up, log in, reset password, and the page links in our emails open (/auth/callback/).
// Email sign-ups stay guests until they click the link in the confirmation email.

import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import { useAccount } from "./session.js";

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
  }
  if (e.status === 0 || /fetch|network/i.test(e.message ?? "")) return tt("Can't reach the server. Check your connection and try again.", "无法连接服务器，请检查网络后重试。");
  if (/Database error saving new user/i.test(e.message ?? "")) return tt("That username was just taken. Please choose another.", "该用户名刚被占用，请换一个。");
  return tt("Something went wrong. Please try again.", "出了点问题，请重试。");
}

/** Absolute address of the page our email links open, in the current language. */
function callbackUrl(href: (p: string) => string): string {
  return new URL(href("/auth/callback"), location.href).toString();
}

/** A same-site path to return to after logging in ("/bots"), or "/" for anything else. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
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

function Field(props: {
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

function FormError({ text }: { text: string | null }) {
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
  const [problem, setProblem] = useState<UsernameProblem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const checked = useRef("");

  // Check the name as it is typed: format here, reserved or taken on the server.
  useEffect(() => {
    setProblem(null);
    if (!username) return;
    const local = usernameFormatProblem(username);
    const t = setTimeout(
      () => {
        if (local) return setProblem(local);
        void account
          .client()
          .then((sb) => sb.rpc("username_problem", { name: username }))
          .then(({ data }) => {
            checked.current = username;
            setProblem((data as UsernameProblem | null) ?? null);
          })
          .catch(() => {});
      },
      local ? 600 : 350,
    );
    return () => clearTimeout(t);
  }, [username, account]);

  if (account.state.status === "off") return <Unavailable />;
  if (account.state.status === "signedIn") return <SignedInAlready />;

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
          "Free. An account will keep your progress, ratings and games on every device. Accounts are new: for now your progress still stays in this browser, and moving it into your account comes next.",
          "免费注册。账号将在所有设备上保存你的进度、等级分和对局。账号功能刚刚上线：目前进度仍保存在本浏览器，下一步会把它转入你的账号。",
        )}
      </p>
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

type CallbackStep = { kind: "working" } | { kind: "confirmed" } | { kind: "otherBrowser" } | { kind: "newPassword" } | { kind: "passwordSaved" } | { kind: "failed"; message: string };

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
    const errorCode = query.get("error_code") ?? hash.get("error_code");
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
        await account.refresh();
        // redirectType is returned at runtime but missing from the published types.
        setStep((data as { redirectType?: string | null }).redirectType === "recovery" ? { kind: "newPassword" } : { kind: "confirmed" });
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
