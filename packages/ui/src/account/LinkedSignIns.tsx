"use client";
// Settings → Linked sign-ins: connect or disconnect Google, Microsoft and GitHub. The last way
// to sign in can't be removed (Supabase refuses it too).

import type { UserIdentity } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { useNav } from "../nav.js";
import { useT } from "../settings.js";
import { PROVIDERS, type Provider, useAccount } from "./session.js";

const NEXT_KEY = "xq:auth-next";

export function LinkedSignIns() {
  const { tt } = useT();
  const nav = useNav();
  const account = useAccount();
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const signedIn = account.state.status === "signedIn";

  const load = async () => {
    const sb = await account.client();
    const { data, error } = await sb.auth.getUserIdentities();
    if (error) setError(tt("Couldn't load your sign-in methods.", "无法读取登录方式。"));
    else setIdentities(data.identities);
  };
  useEffect(() => {
    if (!signedIn) return;
    void load();
    void account.providers().then(setProviders);
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!signedIn) return null;

  const connect = async (provider: Provider) => {
    setError(null);
    setBusy(provider);
    try {
      sessionStorage.setItem(NEXT_KEY, "/settings?tab=account");
    } catch {}
    const sb = await account.client();
    const redirectTo = new URL(nav.href("/auth/callback"), location.href).toString();
    const { error } = await sb.auth.linkIdentity({ provider, options: provider === "azure" ? { redirectTo, scopes: "email" } : { redirectTo } });
    if (error) {
      setBusy(null);
      setError(tt("Couldn't start connecting. Please try again.", "无法开始关联，请重试。"));
    }
  };
  const disconnect = async (identity: UserIdentity) => {
    setError(null);
    setBusy(identity.provider);
    const sb = await account.client();
    const { error } = await sb.auth.unlinkIdentity(identity);
    setBusy(null);
    if (error) setError(tt("Couldn't disconnect it. Please try again.", "无法取消关联，请重试。"));
    else await load();
  };

  const hasEmail = identities?.some((i) => i.provider === "email") ?? false;
  const count = identities?.length ?? 0;
  return (
    <div className="linked-sign-ins">
      <h2>{tt("Linked sign-ins", "登录方式")}</h2>
      {identities === null ? (
        <p className="muted">…</p>
      ) : (
        <ul>
          {hasEmail && (
            <li>
              <span>{tt("Email and password", "邮箱和密码")}</span>
              <span className="muted">{tt("Connected", "已关联")}</span>
            </li>
          )}
          {PROVIDERS.filter((p) => providers.includes(p.id) || identities.some((i) => i.provider === p.id)).map((p) => {
            const identity = identities.find((i) => i.provider === p.id);
            const detail = identity?.identity_data?.email as string | undefined;
            return (
              <li key={p.id}>
                <span>
                  {p.name}
                  {detail && <span className="muted"> · {detail}</span>}
                </span>
                {identity ? (
                  <button
                    type="button"
                    disabled={count <= 1 || busy !== null}
                    title={count <= 1 ? tt("Your only way to sign in can't be removed.", "唯一的登录方式不能移除。") : undefined}
                    onClick={() => void disconnect(identity)}
                  >
                    {busy === p.id ? "…" : tt("Disconnect", "取消关联")}
                  </button>
                ) : (
                  <button type="button" disabled={busy !== null} onClick={() => void connect(p.id)}>
                    {busy === p.id ? "…" : tt("Connect", "关联")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
