// The daily triage run, the same on any system (docs/moderator-runbook.md, "Setting up the daily
// run"): verdicts on open reports, any automatic steps they take, then the summary for the
// review page. A scheduler (schedule.mjs sets one up) starts it once a day.
//
//   node packages/triage/scripts/daily.mjs [--dry-run]
//
// The Supabase access token comes from SUPABASE_ACCESS_TOKEN, else the file named by
// XQ_TOKEN_FILE, else ~/.config/xiangqi-supabase-token. Output is printed and also kept in
// ~/.xiangqi-triage/YYYY-MM-DD.log (30 days), because some schedulers keep no output.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const logDir = join(homedir(), ".xiangqi-triage");
mkdirSync(logDir, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const logFile = join(logDir, `${today}.log`);
for (const f of readdirSync(logDir)) {
  const day = f.match(/^(\d{4}-\d{2}-\d{2})\.log$/)?.[1];
  if (day && Date.now() - Date.parse(day) > 30 * 86_400_000) rmSync(join(logDir, f));
}
const log = (text) => {
  process.stdout.write(text);
  appendFileSync(logFile, text);
};
log(`\n=== ${new Date().toISOString()} daily triage\n`);

let token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  const file = process.env.XQ_TOKEN_FILE ?? join(homedir(), ".config", "xiangqi-supabase-token");
  if (!existsSync(file)) {
    log(`No Supabase access token: set SUPABASE_ACCESS_TOKEN or save one to ${file}\n`);
    process.exit(1);
  }
  token = readFileSync(file, "utf8").trim();
}

const triage = fileURLToPath(new URL("./triage.mjs", import.meta.url));
const child = spawn(process.execPath, [triage, ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL("../../..", import.meta.url)),
  env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => log(d.toString()));
child.stderr.on("data", (d) => log(d.toString()));
child.on("close", (code) => {
  log(`=== exit ${code}\n`);
  process.exit(code ?? 1);
});
