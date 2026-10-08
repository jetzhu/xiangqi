"use client";
// Who is signed in. Accounts run on Supabase; the site works without it (the playground, a
// build without keys), and then the account parts of the UI are simply hidden.
//
// The Supabase library (~50 KB) loads only when it is needed: when this browser already holds
// a session, or when someone opens a sign-in page. Guests never download it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export interface AccountConfig {
  /** Project URL, e.g. https://abcd.supabase.co */
  url: string;
  /** Publishable (anon) key: safe to ship in the site, row-level security does the guarding. */
  key: string;
}

export interface AccountUser {
  id: string;
  email: string;
  username: string;
}

export type AccountState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "guest" }
  | { status: "signedIn"; user: AccountUser };

export interface Account {
  state: AccountState;
  /** The Supabase client, loaded on first use. Throws when accounts are off. */
  client: () => Promise<SupabaseClient>;
  /** Re-reads the session and profile (after sign-in, or a username change). */
  refresh: () => Promise<void>;
  /** Signs out on this device only. */
  signOut: () => Promise<void>;
}

/** Where supabase-js keeps the session: "sb-<project ref>-auth-token" in localStorage. */
export const sessionKey = (url: string) => `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;

function hasStoredSession(config: AccountConfig): boolean {
  try {
    return localStorage.getItem(sessionKey(config.url)) !== null;
  } catch {
    return false;
  }
}

const OFF: Account = {
  state: { status: "off" },
  client: () => Promise.reject(new Error("Accounts are not configured")),
  refresh: async () => {},
  signOut: async () => {},
};

const AccountContext = createContext<Account>(OFF);

export function AccountProvider({ config, children }: { config: AccountConfig | null; children: ReactNode }) {
  const [state, setState] = useState<AccountState>(config ? { status: "loading" } : { status: "off" });
  const clientRef = useRef<Promise<SupabaseClient> | null>(null);

  const client = useCallback(() => {
    if (!config) return Promise.reject(new Error("Accounts are not configured"));
    clientRef.current ??= import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(config.url, config.key, {
        // Links in our emails carry a token_hash the callback page verifies itself.
        auth: { flowType: "pkce", detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
      }),
    );
    return clientRef.current;
  }, [config]);

  const load = useCallback(async () => {
    if (!config) return;
    const sb = await client();
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    if (!user) {
      setState({ status: "guest" });
      return;
    }
    const { data: profile } = await sb.from("profiles").select("username").eq("user_id", user.id).maybeSingle();
    setState({
      status: "signedIn",
      user: { id: user.id, email: user.email ?? "", username: (profile?.username as string | undefined) ?? (user.user_metadata.username as string | undefined) ?? "" },
    });
  }, [config, client]);

  useEffect(() => {
    if (!config) return;
    if (!hasStoredSession(config)) {
      setState({ status: "guest" });
      return;
    }
    let live = true;
    let unsubscribe = () => {};
    void load().catch(() => live && setState({ status: "guest" }));
    void client().then((sb) => {
      if (!live) return;
      // Sign-in or sign-out in another tab, or a session that could not be refreshed.
      const { data } = sb.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") setState({ status: "guest" });
        else if (event === "SIGNED_IN" || event === "USER_UPDATED") void load();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [config, client, load]);

  const signOut = useCallback(async () => {
    const sb = await client();
    await sb.auth.signOut({ scope: "local" });
    setState({ status: "guest" });
  }, [client]);

  const value = useMemo<Account>(() => (config ? { state, client, refresh: load, signOut } : OFF), [config, state, client, load, signOut]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export const useAccount = () => useContext(AccountContext);
