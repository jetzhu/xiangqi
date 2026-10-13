// Runs each bundled server function as Supabase would (Deno.serve, its environment), to catch
// bundling mistakes before a deploy. The handlers' rules are tested in @xq/records and @xq/online.
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs script, without types
import { bundle } from "../scripts/functions.mjs";

describe.each(["record", "game"])("the %s function bundle", (name) => {
  it("starts, answers the CORS check, and asks for sign-in", async () => {
    const code: string = await bundle(name);
    let handler!: (req: Request) => Promise<Response>;
    const fetched: string[] = [];
    (globalThis as Record<string, unknown>).Deno = {
      env: { get: (k: string) => ({ SUPABASE_URL: "https://ref.supabase.co", SUPABASE_SECRET_KEYS: '{"default":"sb_secret_test"}' })[k] },
      serve: (h: typeof handler) => void (handler = h),
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      fetched.push(url);
      return new Response("{}", { status: 401 });
    }) as typeof fetch;
    try {
      await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
      const options = await handler(new Request(`https://ref.supabase.co/functions/v1/${name}`, { method: "OPTIONS" }));
      expect(options.status).toBe(204);
      const anon = await handler(new Request(`https://ref.supabase.co/functions/v1/${name}`, { method: "POST", body: "{}" }));
      expect(anon.status).toBe(401);
      const forged = await handler(new Request(`https://ref.supabase.co/functions/v1/${name}`, { method: "POST", headers: { authorization: "Bearer forged" }, body: "{}" }));
      expect(forged.status).toBe(401);
      expect(fetched).toEqual(["https://ref.supabase.co/auth/v1/user"]);
    } finally {
      globalThis.fetch = realFetch;
      delete (globalThis as Record<string, unknown>).Deno;
    }
  });
});
