// The `mailer` server function (Supabase Edge Function), docs/v0.4-design.md M23: sends the
// emails waiting in the database's outbox over SMTP. The database pokes it every minute while
// mail is due (poke_mailer), with a shared key. Its settings (SMTP account, sender, key) come
// from the database's vault (mailer_settings); scripts/mail-setup.mjs stores them.
import { Smtp } from "./smtp.js";
import { render } from "./templates.js";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): void;
  connectTls(o: { hostname: string; port: number }): Promise<{ readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>; close(): void }>;
};

const env = (name: string) => {
  const v = Deno.env.get(name);
  if (v === undefined) throw new Error(`the mailer needs ${name}`);
  return v;
};

interface Settings {
  key?: string;
  smtp_host?: string;
  smtp_port?: string;
  smtp_user?: string;
  smtp_pass?: string;
  mail_from?: string;
  site_url?: string;
}

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
  const key = keys.default ?? Object.values(keys)[0];
  if (!key) throw new Error("no service key in the function's environment");
  return key;
}

async function rpc<T>(fn: string, args: object): Promise<T> {
  const key = serviceKey();
  const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** Equal strings, compared in constant time. */
const same = (a: string, b: string) => a.length === b.length && [...a].reduce((x, c, i) => x | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("no", { status: 405 });
  const settings = await rpc<Settings>("mailer_settings", {});
  if (!settings.key || !same(req.headers.get("x-mailer-key") ?? "", settings.key)) return new Response("no", { status: 403 });
  const setting = (name: keyof Settings, fallback?: string) => {
    const v = settings[name] ?? fallback;
    if (!v) throw new Error(`the mailer needs ${name} (scripts/mail-setup.mjs)`);
    return v;
  };
  const batch = await rpc<{ id: number; to: string; template: string; lang: string; data: Record<string, unknown> }[]>("mail_claim", { p_limit: 20 });
  if (batch.length === 0) return Response.json({ sent: 0 });
  const host = setting("smtp_host", "smtp.gmail.com");
  const user = setting("smtp_user");
  const from = setting("mail_from", `Xiangqi School 象棋学堂 <${user}>`);
  const site = setting("site_url", "https://jetzhu.github.io/xiangqi");
  let sent = 0;
  const handled = new Set<number>();
  let smtp: Smtp | null = null;
  try {
    smtp = new Smtp(await Deno.connectTls({ hostname: host, port: Number(setting("smtp_port", "465")) }));
    await smtp.open("xiangqi-mailer", user, setting("smtp_pass"));
    for (const m of batch) {
      try {
        const { subject, text } = render(m.template, m.lang, m.data, site);
        await smtp.mail({ from, to: m.to, subject, text });
        handled.add(m.id);
        await rpc("mail_done", { p_id: m.id, p_error: null });
        sent++;
      } catch (e) {
        handled.add(m.id);
        await rpc("mail_done", { p_id: m.id, p_error: e instanceof Error ? e.message : String(e) });
        await smtp.reset().catch(() => {});
      }
    }
  } catch (e) {
    // Couldn't connect or sign in: every unsent one is tried again in 10 minutes.
    const error = e instanceof Error ? e.message : String(e);
    console.error(error);
    for (const m of batch.filter((x) => !handled.has(x.id))) await rpc("mail_done", { p_id: m.id, p_error: error }).catch(() => {});
  } finally {
    await smtp?.quit();
  }
  return Response.json({ sent, failed: batch.length - sent });
});
