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
  /** False while the name is the placeholder given to a Google/Microsoft/GitHub sign-up. */
  usernameChosen: boolean;
}

/** Sign-in providers the site offers besides email (Supabase calls Microsoft "azure"). */
export type Provider = "google" | "azure" | "github";
export const PROVIDERS: { id: Provider; name: string }[] = [
  { id: "google", name: "Google" },
  { id: "azure", name: "Microsoft" },
  { id: "github", name: "GitHub" },
];

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
  refresh: () => Promise<AccountState>;
  /** Providers switched on in the Supabase project, in display order. */
  providers: () => Promise<Provider[]>;
  /** Signs out on this device only. */
  signOut: () => Promise<void>;
  /** The user id of the session stored in this browser, read without loading Supabase. */
  storedUserId: () => string | null;
  /** Runs `fn` before signing out (e.g. sending unsaved progress); returns an unsubscribe. */
  beforeSignOut: (fn: () => Promise<unknown>) => () => void;
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

function storedUserId(config: AccountConfig | null): string | null {
  if (!config) return null;
  try {
    const raw = localStorage.getItem(sessionKey(config.url));
    const id = raw ? (JSON.parse(raw) as { user?: { id?: unknown } }).user?.id : undefined;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/** Unsaved progress gets this long to reach the server before signing out goes ahead. */
const SIGN_OUT_WAIT_MS = 3000;

const OFF: Account = {
  state: { status: "off" },
  client: () => Promise.reject(new Error("Accounts are not configured")),
  refresh: async () => ({ status: "off" }),
  providers: async () => [],
  signOut: async () => {},
  storedUserId: () => null,
  beforeSignOut: () => () => {},
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

  const load = useCallback(async (): Promise<AccountState> => {
    if (!config) return { status: "off" };
    const sb = await client();
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    let next: AccountState = { status: "guest" };
    if (user) {
      const { data: profile } = await sb.from("profiles").select("username, username_chosen").eq("user_id", user.id).maybeSingle();
      next = {
        status: "signedIn",
        user: {
          id: user.id,
          email: user.email ?? "",
          username: (profile?.username as string | undefined) ?? (user.user_metadata.username as string | undefined) ?? "",
          usernameChosen: (profile?.username_chosen as boolean | undefined) ?? true,
        },
      };
    }
    setState(next);
    return next;
  }, [config, client]);

  const providersRef = useRef<Promise<Provider[]> | null>(null);
  const providers = useCallback(() => {
    if (!config) return Promise.resolve([]);
    // Public settings: which sign-in methods the project has switched on.
    providersRef.current ??= fetch(`${config.url}/auth/v1/settings`, { headers: { apikey: config.key } })
      .then((r) => r.json() as Promise<{ external?: Record<string, boolean> }>)
      .then((s) => PROVIDERS.filter((p) => s.external?.[p.id]).map((p) => p.id))
      .catch(() => {
        providersRef.current = null;
        return [];
      });
    return providersRef.current;
  }, [config]);

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

  const hooks = useRef(new Set<() => Promise<unknown>>());
  const beforeSignOut = useCallback((fn: () => Promise<unknown>) => {
    hooks.current.add(fn);
    return () => void hooks.current.delete(fn);
  }, []);
  const stored = useCallback(() => storedUserId(config), [config]);

  const signOut = useCallback(async () => {
    const wait = new Promise((done) => setTimeout(done, SIGN_OUT_WAIT_MS));
    await Promise.race([Promise.allSettled([...hooks.current].map((fn) => fn())), wait]);
    const sb = await client();
    await sb.auth.signOut({ scope: "local" });
    setState({ status: "guest" });
  }, [client]);

  const value = useMemo<Account>(() => (config ? { state, client, refresh: load, providers, signOut, storedUserId: stored, beforeSignOut } : OFF),
    [config, state, client, load, providers, signOut, stored, beforeSignOut],
  );
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export const useAccount = () => useContext(AccountContext);
