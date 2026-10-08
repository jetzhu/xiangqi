// Brings a Supabase project up to date: runs migrations it hasn't had yet, then sets the
// auth settings and email templates below. Uses the Management API, so it needs only a
// personal access token (supabase.com/dashboard/account/tokens), never the database password.
//
//   SUPABASE_ACCESS_TOKEN=$(cat ~/.config/xiangqi-supabase-token) node scripts/apply.mjs [--dry-run]
//
// The project is the one the site is built with (apps/web/.env), or SUPABASE_PROJECT_REF.
import { readFileSync, readdirSync } from "node:fs";

const here = (p) => new URL(`../${p}`, import.meta.url);
const env = readFileSync(new URL("../../../apps/web/.env", import.meta.url), "utf8");
const projectUrl = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1]?.trim();
const ref = process.env.SUPABASE_PROJECT_REF ?? new URL(projectUrl).hostname.split(".")[0];
const site = "https://jetzhu.github.io/xiangqi/";
const template = (name) => readFileSync(here(`supabase/templates/${name}.html`), "utf8");

/** Auth settings, as the Management API names them. */
const AUTH = {
  // Where links in emails go when no allowed redirect is given: the live site.
  site_url: site,
  // Pages Supabase may send people back to: the live site, `pnpm dev`, and the e2e server.
  uri_allow_list: [`${site}**`, "http://localhost:3000/**", "http://127.0.0.1:4100/**"].join(","),
  external_email_enabled: true,
  mailer_autoconfirm: false, // email sign-ups stay guests until they click the link
  mailer_secure_email_change_enabled: true, // an email change is confirmed from both addresses
  password_min_length: 8,
  smtp_max_frequency: 60, // seconds between emails to one address
  // Emails in both languages: each template picks English or Chinese from the language saved
  // with the account at sign-up (.Data.lang; Chinese unless it is "en").
  mailer_subjects_confirmation: "Confirm your email · 确认你的邮箱 — Xiangqi School 象棋学堂",
  mailer_templates_confirmation_content: template("confirmation"),
  mailer_subjects_recovery: "Reset your password · 重设密码 — Xiangqi School 象棋学堂",
  mailer_templates_recovery_content: template("recovery"),
  mailer_subjects_email_change: "Confirm your new email · 确认新邮箱 — Xiangqi School 象棋学堂",
  mailer_templates_email_change_content: template("email_change"),
};

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("Set SUPABASE_ACCESS_TOKEN (a personal access token from supabase.com/dashboard/account/tokens).");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");

async function api(method, path, body) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => api("POST", "/database/query", { query });

// Migrations, recorded where the Supabase CLI records them, so either tool can be used later.
await sql(`create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
const applied = new Set((await sql("select version from supabase_migrations.schema_migrations")).map((r) => r.version));
const files = readdirSync(here("supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  const [, version, name] = file.match(/^(\d+)_(.+)\.sql$/);
  if (applied.has(version)) {
    console.log(`= ${file} (already applied)`);
    continue;
  }
  console.log(`${dryRun ? "would apply" : "+"} ${file}`);
  if (dryRun) continue;
  const body = readFileSync(here(`supabase/migrations/${file}`), "utf8");
  const quoted = `$migration$${body}$migration$`;
  // One transaction: the migration and its record land together or not at all.
  await sql(`begin;\n${body}\n;insert into supabase_migrations.schema_migrations (version, name, statements) values ('${version}', '${name}', array[${quoted}]);\ncommit;`);
}

// Auth settings: refuse names the API doesn't know, rather than silently ignoring them.
const current = await api("GET", "/config/auth");
const unknown = Object.keys(AUTH).filter((k) => !(k in current));
if (unknown.length) throw new Error(`Unknown auth settings: ${unknown.join(", ")}`);
const changes = Object.fromEntries(Object.entries(AUTH).filter(([k, v]) => current[k] !== v));
for (const k of Object.keys(changes)) console.log(`${dryRun ? "would set" : "~"} auth.${k}${k.includes("content") ? "" : ` = ${JSON.stringify(changes[k])}`}`);
if (!dryRun && Object.keys(changes).length) await api("PATCH", "/config/auth", changes);
console.log(dryRun ? "Dry run: nothing changed." : `Project ${ref} is up to date.`);
