"use client";
// Settings → Account (M14): email, password, linked sign-ins, log out everywhere, download my
// data and delete the account, as the v0.2 design lays them out.

import type { UserIdentity } from "@supabase/supabase-js";
import { type FormEvent, useEffect, useState } from "react";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import { Field, FormError, MIN_PASSWORD, authErrorText, callbackUrl, rememberNext } from "./AuthPages.js";
import { LinkedSignIns } from "./LinkedSignIns.js";
import { download, exportAccount } from "./exportData.js";
import { PROVIDERS, type Provider, useAccount } from "./session.js";

/** Where the deletion date waits for the signed-out page to show it. */
export const DELETION_NOTICE = "xq:deletion-scheduled";

export function AccountSettings() {
  const account = useAccount();
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const signedIn = account.state.status === "signedIn";
  useEffect(() => {
    if (!signedIn) return;
    void account
      .client()
      .then((sb) => sb.auth.getUserIdentities())
      .then(({ data }) => setIdentities(data?.identities ?? []));
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  if (account.state.status !== "signedIn") return null;
  const hasPassword = identities?.some((i) => i.provider === "email") ?? false;
  const provider = identities?.find((i) => i.provider !== "email")?.provider as Provider | undefined;

  return (
    <div className="account-settings">
      <EmailSection email={account.state.user.email} />
      <PasswordSection hasPassword={hasPassword} />
      <LinkedSignIns />
      <SessionsSection />
      <DataSection />
      <DeleteSection hasPassword={hasPassword} provider={provider} />
    </div>
  );
}

function EmailSection({ email }: { email: string }) {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [next, setNext] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const sb = await account.client();
    const { error } = await sb.auth.updateUser({ email: next }, { emailRedirectTo: callbackUrl(nav.href) });
    setBusy(false);
    if (error) return setError(authErrorText(error, tt));
    setSent(true);
  };
  return (
    <section aria-labelledby="h-email">
      <h2 id="h-email">{tt("Email", "邮箱")}</h2>
      <p className="muted">{email}</p>
      {sent ? (
        <p role="status">
          {tt(
            `Check both inboxes: confirm the change from ${next} and from ${email}. Until then your email stays the same.`,
            `请查收两个邮箱：分别在 ${next} 和 ${email} 中确认修改。确认前邮箱保持不变。`,
          )}
        </p>
      ) : (
        <form className="account-form" onSubmit={(e) => void submit(e)}>
          <Field label={tt("New email", "新邮箱")} type="email" value={next} onChange={setNext} autoComplete="email" />
          <FormError text={error} />
          <button type="submit" disabled={busy || !next || next === email}>
            {busy ? "…" : tt("Change email", "修改邮箱")}
          </button>
        </form>
      )}
    </section>
  );
}

function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const { tt } = useT();
  const account = useAccount();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(tt(`At least ${MIN_PASSWORD} characters.`, `至少 ${MIN_PASSWORD} 个字符。`));
    setBusy(true);
    setError(null);
    const sb = await account.client();
    const { error } = await sb.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      return setError(authErrorText(error, tt));
    }
    // A new password signs out every other device.
    await sb.auth.signOut({ scope: "others" });
    setBusy(false);
    setPassword("");
    setDone(true);
  };
  return (
    <section aria-labelledby="h-password">
      <h2 id="h-password">{tt("Password", "密码")}</h2>
      {!hasPassword && (
        <p className="muted">{tt("You sign in with Google, Microsoft or GitHub. Set a password to sign in with your email too.", "你目前通过 Google、Microsoft 或 GitHub 登录。设置密码后也可以用邮箱登录。")}</p>
      )}
      <form className="account-form" onSubmit={(e) => void submit(e)}>
        <Field
          label={hasPassword ? tt("New password", "新密码") : tt("Password", "密码")}
          type="password"
          value={password}
          onChange={(v) => {
            setPassword(v);
            setDone(false);
          }}
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          hint={tt(`At least ${MIN_PASSWORD} characters. Other devices will be signed out.`, `至少 ${MIN_PASSWORD} 个字符。其他设备将退出登录。`)}
        />
        <FormError text={error} />
        {done && <p className="form-ok">{tt("Password saved. Other devices are signed out.", "密码已保存，其他设备已退出登录。")}</p>}
        <button type="submit" disabled={busy || !password}>
          {busy ? "…" : hasPassword ? tt("Change password", "修改密码") : tt("Set password", "设置密码")}
        </button>
      </form>
    </section>
  );
}

function SessionsSection() {
  const { tt } = useT();
  const account = useAccount();
  const [confirm, setConfirm] = useState(false);
  return (
    <section aria-labelledby="h-sessions">
      <h2 id="h-sessions">{tt("Log out on all devices", "在所有设备上退出登录")}</h2>
      <p className="muted">{tt("Ends every session, this one included. Other devices go back to an empty guest state.", "结束所有登录会话（包括当前设备）。其他设备将回到空白的访客状态。")}</p>
      <button type="button" className={confirm ? "primary" : ""} onClick={() => (confirm ? void account.signOut("global") : setConfirm(true))} onBlur={() => setConfirm(false)}>
        {confirm ? tt("Log out everywhere? Click again to confirm", "确定在所有设备上退出？再点一次确认") : tt("Log out on all devices", "在所有设备上退出登录")}
      </button>
    </section>
  );
}

function DataSection() {
  const { tt } = useT();
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (account.state.status !== "signedIn") return null;
  const user = account.state.user;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await exportAccount(await account.client(), user);
      download(blob, `xiangqi-${user.username}-${new Date().toISOString().slice(0, 10)}.json`);
    } catch {
      setError(tt("Couldn't download your data. Check your connection and try again.", "无法下载数据，请检查网络后重试。"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="h-data">
      <h2 id="h-data">{tt("Download my data", "下载我的数据")}</h2>
      <p className="muted">{tt("A JSON file with your profile, settings, progress, games, puzzle attempts and analyses.", "一个 JSON 文件，包含你的资料、设置、进度、对局、解题记录和分析。")}</p>
      <button type="button" disabled={busy} onClick={() => void go()}>
        {busy ? "…" : tt("Download my data", "下载我的数据")}
      </button>
      <FormError text={error} />
    </section>
  );
}

function DeleteSection({ hasPassword, provider }: { hasPassword: boolean; provider: Provider | undefined }) {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  // Opened again after signing in again with Google/Microsoft/GitHub to confirm.
  const [open, setOpen] = useState(() => typeof location !== "undefined" && new URLSearchParams(location.search).get("delete") === "1");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [needSignIn, setNeedSignIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (account.state.status !== "signedIn") return null;
  const user = account.state.user;
  const providerName = PROVIDERS.find((p) => p.id === provider)?.name ?? "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const sb = await account.client();
      if (hasPassword) {
        // Proves who it is, and makes the sign-in fresh, as the database asks.
        const { error } = await sb.auth.signInWithPassword({ email: user.email, password });
        if (error) return setError(error.code === "invalid_credentials" ? tt("Wrong password.", "密码不正确。") : authErrorText(error, tt));
      }
      const { data, error } = await sb.rpc("request_account_deletion", { p_username: username });
      if (error) {
        if (error.hint === "reauth") return setNeedSignIn(true);
        if (error.hint === "username") return setError(tt("That isn't your username.", "用户名不正确。"));
        return setError(authErrorText(error, tt));
      }
      try {
        sessionStorage.setItem(DELETION_NOTICE, String(data));
      } catch {}
      // Signed out everywhere: signing in again within the 10 days cancels the deletion.
      await account.signOut("global");
    } finally {
      setBusy(false);
    }
  };

  const signInAgain = async () => {
    if (!provider) return;
    rememberNext("/settings?tab=account&delete=1");
    const sb = await account.client();
    await sb.auth.signInWithOAuth({ provider, options: { redirectTo: callbackUrl(nav.href), ...(provider === "azure" ? { scopes: "email" } : {}) } });
  };

  return (
    <section aria-labelledby="h-delete" className="danger-zone">
      <h2 id="h-delete">{tt("Delete account", "删除账号")}</h2>
      <p className="muted">
        {tt(
          "Your account and everything in it are deleted 10 days after you ask. Signing in before then cancels it. Download your data first if you want a copy.",
          "提出申请 10 天后，你的账号及其中所有数据将被删除。在此之前登录即可取消。如需留存，请先下载你的数据。",
        )}
      </p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}>
          {tt("Delete my account…", "删除我的账号…")}
        </button>
      ) : needSignIn && !hasPassword ? (
        <div>
          <p>{tt(`To confirm it's you, sign in again with ${providerName}, then come back here.`, `为确认是你本人，请重新使用 ${providerName} 登录，然后回到这里。`)}</p>
          <button type="button" className="primary" onClick={() => void signInAgain()}>
            {tt(`Sign in again with ${providerName}`, `重新使用 ${providerName} 登录`)}
          </button>
        </div>
      ) : (
        <form className="account-form" onSubmit={(e) => void submit(e)}>
          <Field
            label={tt(`Type your username (${user.username}) to confirm`, `输入你的用户名（${user.username}）以确认`)}
            type="text"
            value={username}
            onChange={setUsername}
            autoComplete="off"
          />
          {hasPassword && <Field label={tt("Password", "密码")} type="password" value={password} onChange={setPassword} autoComplete="current-password" />}
          <FormError text={error} />
          <button type="submit" className="danger" disabled={busy || !username || (hasPassword && !password)}>
            {busy ? "…" : tt("Delete my account in 10 days", "10 天后删除我的账号")}
          </button>{" "}
          <button type="button" className="link-button" onClick={() => setOpen(false)}>
            {tt("Keep my account", "保留账号")}
          </button>
        </form>
      )}
    </section>
  );
}

/** Shown after asking for deletion (signed out): when it happens, and how to cancel it. */
export function DeletionNotice() {
  const { tt, lang } = useT();
  const status = useAccount().state.status;
  const [at, setAt] = useState<string | null>(null);
  // Read again once signed out (the request signs out everywhere), or back in (cancelled).
  useEffect(() => {
    try {
      setAt(status === "signedIn" ? null : sessionStorage.getItem(DELETION_NOTICE));
    } catch {}
  }, [status]);
  if (!at) return null;
  const date = new Date(at).toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { year: "numeric", month: "long", day: "numeric" });
  return (
    <p role="status" className="deletion-notice">
      {tt(
        `Your account will be deleted on ${date}. You've been signed out on every device. Sign in before then to cancel.`,
        `你的账号将于 ${date} 删除。你已在所有设备上退出登录。在此之前登录即可取消。`,
      )}
    </p>
  );
}
