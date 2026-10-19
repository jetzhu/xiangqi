// Runs one SQL statement against the Supabase project through the Management API, for the
// operations in docs/moderator-runbook.md (adding a moderator, the username word list, the
// fair-play and triage settings). Read-only unless --write is given, so a typo can't change data.
//
//   SUPABASE_ACCESS_TOKEN=$(cat ~/.config/xiangqi-supabase-token) node packages/db/scripts/sql.mjs "select …"
//   SUPABASE_ACCESS_TOKEN=… node packages/db/scripts/sql.mjs --write "update …"
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../../../apps/web/.env", import.meta.url), "utf8");
const ref = process.env.SUPABASE_PROJECT_REF ?? new URL(env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)[1].trim()).hostname.split(".")[0];
const token = process.env.SUPABASE_ACCESS_TOKEN;
const write = process.argv.includes("--write");
const query = process.argv.slice(2).filter((a) => a !== "--write").join(" ").trim();

if (!token) {
  console.error("Set SUPABASE_ACCESS_TOKEN (a personal access token from supabase.com/dashboard/account/tokens).");
  process.exit(1);
}
if (!query) {
  console.error('Usage: node packages/db/scripts/sql.mjs [--write] "<one SQL statement>"');
  process.exit(1);
}
// Without --write the statement runs in a read-only transaction: Postgres refuses any change.
const body = write ? query : `begin transaction read only; ${query.replace(/;\s*$/, "")}; commit;`;
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query: body }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`${res.status}: ${text}`);
  process.exit(1);
}
const rows = text ? JSON.parse(text) : [];
if (Array.isArray(rows) && rows.length && typeof rows[0] === "object") console.table(rows);
else console.log(write ? "Done." : "No rows.");
