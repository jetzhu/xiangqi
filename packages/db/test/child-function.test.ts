// The `child` server function against a fake Supabase: the parent's checks go through with the
// parent's session, the identity is made with the server key, and a failed registration undoes it.
import { describe, expect, it } from "vitest";
import { handle } from "../supabase/functions/child/handler.js";

const ENV = { url: "https://x.supabase.co", anonKey: "anon", serviceKey: "service" };

function fake(answers: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; method: string; auth: string | null; body: unknown }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    calls.push({ url, method: init.method ?? "GET", auth: headers.get("authorization"), body: init.body ? JSON.parse(String(init.body)) : null });
    const key = `${init.method ?? "GET"} ${url.replace(ENV.url, "").replace(/\/admin\/users\/[^/]+$/, "/admin/users/:id")}`;
    const a = answers[key] ?? { body: null };
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const post = (body: object, auth = "Bearer parent-jwt") => new Request("https://fn/child", { method: "POST", headers: { authorization: auth }, body: JSON.stringify(body) });

describe("the child function", () => {
  it("creates a profile: the parent's checks with their session, the identity with the server key", async () => {
    const { f, calls } = fake({
      "POST /rest/v1/rpc/child_prepare": { body: { ok: true, lang: "zh" } },
      "GET /auth/v1/user": { body: { id: "parent-1" } },
      "POST /auth/v1/admin/users": { body: { id: "child-1" } },
      "POST /rest/v1/rpc/child_register": { body: { consent: 1 } },
    });
    const res = await handle(post({ action: "create", nickname: "Mei", birthYear: 2018, country: "US", notice: "v1" }), ENV, f);
    expect(await res.json()).toEqual({ id: "child-1" });
    expect(calls[0]).toMatchObject({ url: `${ENV.url}/rest/v1/rpc/child_prepare`, auth: "Bearer parent-jwt" });
    const created = calls.find((c) => c.url.endsWith("/admin/users"))!;
    expect(created.auth).toBe("Bearer service");
    expect(created.body).toMatchObject({ email_confirm: true, app_metadata: { child: true }, user_metadata: { lang: "zh" } });
    expect((created.body as { email: string }).email).toMatch(/^child-[0-9a-f-]{36}@children\.xiangqi\.invalid$/);
    expect(calls.at(-1)!.body).toMatchObject({ p_parent: "parent-1", p_child: "child-1", p_nickname: "Mei" });
  });

  it("passes the database's refusal on, and makes nothing", async () => {
    const { f, calls } = fake({ "POST /rest/v1/rpc/child_prepare": { status: 400, body: { message: "not offered in mainland China yet", hint: "china" } } });
    const res = await handle(post({ action: "create", nickname: "Mei", birthYear: 2018, country: "CN", notice: "v1" }), ENV, f);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not offered in mainland China yet", hint: "china" });
    expect(calls).toHaveLength(1);
  });

  it("removes the identity again if registering it fails", async () => {
    const { f, calls } = fake({
      "POST /rest/v1/rpc/child_prepare": { body: { ok: true, lang: "en" } },
      "GET /auth/v1/user": { body: { id: "parent-1" } },
      "POST /auth/v1/admin/users": { body: { id: "child-2" } },
      "POST /rest/v1/rpc/child_register": { status: 500, body: { message: "boom" } },
    });
    const res = await handle(post({ action: "create", nickname: "Bo", birthYear: 2017, country: "US", notice: "v1" }), ENV, f);
    expect(res.status).toBe(502);
    expect(calls.at(-1)).toMatchObject({ url: `${ENV.url}/auth/v1/admin/users/child-2`, method: "DELETE" });
  });

  it("opens a profile with a one-time sign-in, only after the parent's check", async () => {
    const { f, calls } = fake({
      "POST /rest/v1/rpc/child_switch_check": { body: "child-1@children.xiangqi.invalid" },
      "POST /auth/v1/admin/generate_link": { body: { properties: { hashed_token: "th1" } } },
    });
    const res = await handle(post({ action: "switch", child: "child-1" }), ENV, f);
    expect(await res.json()).toEqual({ token_hash: "th1" });
    expect(calls[1]!.body).toEqual({ type: "magiclink", email: "child-1@children.xiangqi.invalid" });
    expect((await handle(post({ action: "switch", child: "c" }, ""), ENV, f)).status).toBe(401);
  });
});
