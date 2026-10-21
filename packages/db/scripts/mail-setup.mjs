// Connects the `mailer` function to Gmail and the database to the mailer (docs/v0.4-design.md,
// M23). Run after functions.mjs has deployed it, and again whenever the app password changes:
//
//   SUPABASE_ACCESS_TOKEN=$(cat ~/.config/xiangqi-supabase-token) node scripts/mail-setup.mjs [--test you@example.com]
//
// The sender is the Gmail account sign-in emails already use (the project's SMTP settings);
// its app password is read from ~/.config/xiangqi-gmail-app-password (or SMTP_PASS) and stored
// in the database's vault (encrypted; only the server reads it, through mailer_settings), with
// the other settings. A fresh key that the database sends with each poke goes in the private
// mailer_config table. --test queues a test email.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const env = readFileSync(new URL("../../../apps/web/.env", import.meta.url), "utf8");
const projectUrl = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1]?.trim();
const ref = process.env.SUPABASE_PROJECT_REF ?? new URL(projectUrl).hostname.split(".")[0];
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error("Set SUPABASE_ACCESS_TOKEN.");
const api = async (path, init = {}) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};
/** Text into SQL safely (base64, decoded by Postgres). */
const sqlText = (s) => `convert_from(decode('${Buffer.from(s, "utf8").toString("base64")}', 'base64'), 'utf8')`;
const sql = (query) => api("/database/query", { method: "POST", body: JSON.stringify({ query }) });

const auth = await api("/config/auth");
if (!auth.smtp_host || !auth.smtp_user) throw new Error("The project has no SMTP settings for sign-in emails; set those up first.");
let pass = process.env.SMTP_PASS;
if (!pass) {
  const file = join(homedir(), ".config", "xiangqi-gmail-app-password");
  try {
    pass = readFileSync(file, "utf8").replace(/\s+/g, "");
  } catch {
    throw new Error(`Save the Gmail app password for ${auth.smtp_user} to ${file} (mode 600), then run this again.`);
  }
}
const key = randomBytes(32).toString("hex");
const sender = auth.smtp_admin_email || auth.smtp_user;
const secrets = {
  // Port 465 (implicit TLS): Supabase's functions can't connect out on 25 or 587.
  mailer_smtp_host: auth.smtp_host,
  mailer_smtp_port: "465",
  mailer_smtp_user: auth.smtp_user,
  mailer_smtp_pass: pass,
  mailer_mail_from: `${auth.smtp_sender_name || "Xiangqi School 象棋学堂"} <${sender}>`,
  mailer_site_url: "https://jetzhu.github.io/xiangqi",
};
const values = Object.entries(secrets)
  .map(([name, value]) => `(${sqlText(name)}, ${sqlText(value)})`)
  .join(", ");
await sql(
  `select vault.update_secret(s.id, x.v) from vault.secrets s join (values ${values}) x(n, v) on s.name = x.n;
   select vault.create_secret(x.v, x.n) from (values ${values}) x(n, v) where not exists (select 1 from vault.secrets s where s.name = x.n);`,
);
await sql(
  `insert into public.mailer_config (key, value) values ('url', ${sqlText(`${projectUrl.replace(/\/$/, "")}/functions/v1/mailer`)}), ('key', ${sqlText(key)})
   on conflict (key) do update set value = excluded.value`,
);
console.log(`Mailer set up: sending as ${secrets.mailer_mail_from} through ${auth.smtp_host}:465.`);

const i = process.argv.indexOf("--test");
if (i >= 0) {
  const to = process.argv[i + 1];
  if (!to) throw new Error("--test needs an address");
  await sql(`select public.queue_mail(${sqlText(to)}, 'test', 'en', '{}'::jsonb, null)`);
  console.log(`Test email to ${to} queued; it goes within a minute or two.`);
}
