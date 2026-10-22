// The `child` server function's work (M24, docs/v0.4-design.md "Child profiles"), apart from
// Deno so tests can run it: a parent creates a child profile (its own sign-in identity, with an
// address that never receives mail), or opens one on their device. Every check is the
// database's, made with the parent's own session (child_prepare, child_switch_check); this only
// does what needs the server key: making the identity and a one-time sign-in for it.

export interface Env {
  url: string;
  /** The project's public key, sent with the parent's session. */
  anonKey: string;
  serviceKey: string;
}

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-max-age": "86400",
};

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

/** The database's error, passed on with its hint for the page to explain. */
class DbError extends Error {
  constructor(
    message: string,
    readonly hint: string | null,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call(f: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  const res = await f(url, init);
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const e = (body ?? {}) as { message?: string; msg?: string; hint?: string };
    throw new DbError(e.message ?? e.msg ?? `request failed (${res.status})`, e.hint ?? null, res.status);
  }
  return body;
}

/** A six-digit random suffix for the private placeholder username. */
const placeholder = () => `kid-${String(Math.floor(1_000_000 + Math.random() * 9_000_000))}`;

export async function handle(req: Request, env: Env, f: typeof fetch = fetch): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return reply({ error: "sign in first" }, 401);
  const asParent = (fn: string, args: object) =>
    call(f, `${env.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: env.anonKey, authorization: auth, "content-type": "application/json" }, body: JSON.stringify(args) });
  const server = { apikey: env.serviceKey, authorization: `Bearer ${env.serviceKey}`, "content-type": "application/json" };
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.action === "create") {
      const args = { p_nickname: body.nickname, p_birth_year: body.birthYear, p_country: body.country, p_notice: body.notice, p_statement: body.statement ?? null };
      const prepared = (await asParent("child_prepare", args)) as { lang: string };
      const parent = (await call(f, `${env.url}/auth/v1/user`, { headers: { apikey: env.anonKey, authorization: auth } })) as { id: string };
      const created = (await call(f, `${env.url}/auth/v1/admin/users`, {
        method: "POST",
        headers: server,
        body: JSON.stringify({
          email: `child-${crypto.randomUUID()}@children.xiangqi.invalid`,
          email_confirm: true,
          user_metadata: { username: placeholder(), lang: prepared.lang },
          app_metadata: { child: true },
        }),
      })) as { id: string };
      try {
        await call(f, `${env.url}/rest/v1/rpc/child_register`, {
          method: "POST",
          headers: server,
          body: JSON.stringify({ p_parent: parent.id, p_child: created.id, p_nickname: body.nickname, p_birth_year: body.birthYear, p_country: body.country, p_statement: body.statement ?? null }),
        });
      } catch (e) {
        // Nothing half-made is left behind.
        await call(f, `${env.url}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: server }).catch(() => {});
        throw e;
      }
      return reply({ id: created.id });
    }
    if (body.action === "switch") {
      const email = (await asParent("child_switch_check", { p_child: body.child })) as string;
      const link = (await call(f, `${env.url}/auth/v1/admin/generate_link`, { method: "POST", headers: server, body: JSON.stringify({ type: "magiclink", email }) })) as {
        hashed_token?: string;
        properties?: { hashed_token?: string };
      };
      const tokenHash = link.properties?.hashed_token ?? link.hashed_token;
      if (!tokenHash) throw new DbError("no sign-in link", null, 500);
      return reply({ token_hash: tokenHash });
    }
    return reply({ error: "unknown action" }, 400);
  } catch (e) {
    if (e instanceof DbError) return reply({ error: e.message, hint: e.hint }, e.status >= 500 ? 502 : 400);
    console.error(e);
    return reply({ error: "server error" }, 500);
  }
}
