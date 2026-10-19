// Shared by the load-test scripts (M20). They run against the STAGING project only: the live
// project's reference is refused, so a load test can never touch real players.
//
//   export STAGING_REF=qjsklyyyknawhikbzvww
//   export STAGING_KEY=<the staging project's publishable (anon) key>
//   export SUPABASE_ACCESS_TOKEN=$(tr -d '\n' < ~/.config/xiangqi-staging-supabase-token)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const LIVE_REF = "cxawhlamdwgojfzzgvqy";
export const REF = process.env.STAGING_REF;
export const KEY = process.env.STAGING_KEY;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || REF === LIVE_REF) {
  console.error(REF === LIVE_REF ? "Refusing to load-test the live project." : "Set STAGING_REF to the staging project's reference.");
  process.exit(1);
}
export const URL_ = `https://${REF}.supabase.co`;

/** The synthetic players' shared password: made once, kept in ~/.config (mode 600), never printed. */
export function password() {
  const file = join(homedir(), ".config", "xiangqi-loadtest-password");
  if (!existsSync(file)) writeFileSync(file, randomBytes(18).toString("base64url"), { mode: 0o600 });
  return readFileSync(file, "utf8").trim();
}

/** One SQL statement through the Management API (setup and measurements, not the load itself). */
export async function sql(query) {
  if (!TOKEN) throw new Error("Set SUPABASE_ACCESS_TOKEN to the staging token.");
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`sql: ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : [];
}

/** Auth settings on staging (e.g. raising sign-in rate limits so hundreds of players can sign in). */
export async function patchAuth(changes) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(changes),
  });
  if (!res.ok) throw new Error(`auth config: ${res.status} ${(await res.text()).slice(0, 300)}`);
}

export const username = (i) => `lt-${String(i).padStart(4, "0")}`;

/** Signs a synthetic player in; returns their access token. */
export async function signIn(i) {
  if (!KEY) throw new Error("Set STAGING_KEY to the staging project's publishable (anon) key.");
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: `${username(i)}@loadtest.invalid`, password: password() }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in ${username(i)}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body.access_token;
}

/** Calls a database function as a signed-in player; returns { ms, ok, data, status }. */
export async function rpc(token, fn, args = {}) {
  const t0 = performance.now();
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  return { ms: performance.now() - t0, ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

/** Calls the `game` server function as a player. */
export async function gameFn(token, body) {
  const t0 = performance.now();
  const res = await fetch(`${URL_}/functions/v1/game`, {
    method: "POST",
    headers: { apikey: KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ms: performance.now() - t0, ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

/** Latency summary: count, p50, p95, p99, max (ms). */
export function summary(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const at = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
  return { n: s.length, p50: Math.round(at(0.5)), p95: Math.round(at(0.95)), p99: Math.round(at(0.99)), max: Math.round(s.at(-1) ?? 0) };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};

/**
 * Tokens for players from..from+n-1. Sessions last an hour, so they're kept in a private cache
 * (~/.cache, mode 600) and reused; new sign-ins go a few at a time and wait out the auth
 * service's per-address rate limit when they meet it.
 */
export async function signInAll(n, from = 0) {
  const file = join(homedir(), ".cache", `xiangqi-loadtest-${REF}.json`);
  let cache = {};
  try {
    cache = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  const fresh = (i) => cache[i] && cache[i].until > Date.now() + 20 * 60_000;
  const need = Array.from({ length: n }, (_, k) => from + k).filter((i) => !fresh(i));
  if (need.length) console.log(`(${need.length} sign-ins; ${n - need.length} sessions reused)`);
  for (let k = 0; k < need.length; k += 5) {
    const batch = need.slice(k, k + 5);
    for (;;) {
      try {
        const got = await Promise.all(batch.map((i) => signIn(i)));
        batch.forEach((i, j) => (cache[i] = { token: got[j], until: Date.now() + 55 * 60_000 }));
        break;
      } catch (e) {
        if (!/429/.test(String(e))) throw e;
        console.log("  rate limited; waiting 30 s");
        await sleep(30_000);
      }
    }
    mkdirSync(join(homedir(), ".cache"), { recursive: true });
    writeFileSync(file, JSON.stringify(cache), { mode: 0o600 });
  }
  return Array.from({ length: n }, (_, k) => cache[from + k].token);
}
