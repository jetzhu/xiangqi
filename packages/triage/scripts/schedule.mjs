// Sets up (or removes) the once-a-day triage run on this computer, with the system's own
// scheduler (docs/moderator-runbook.md, "Setting up the daily run"):
//   Linux    a systemd user timer (catches up at the next log-in if the computer was off),
//            or a crontab line where systemd isn't available
//   macOS    a launchd agent (catches up after sleep, not after power-off)
//   Windows  a Task Scheduler task ("run as soon as possible after a missed start")
//
//   node packages/triage/scripts/schedule.mjs install [--at 07:30]
//   node packages/triage/scripts/schedule.mjs uninstall
//   node packages/triage/scripts/schedule.mjs print [--platform linux|darwin|win32]   shows what install would do
//
// Each runs `node packages/triage/scripts/daily.mjs` with this Node, and finds `claude` on PATH
// now so the scheduler can too.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const action = args[0] ?? "print";
const platform = opt("--platform", process.platform);
const [hour, minute] = opt("--at", "07:30").split(":").map(Number);
if (!(hour >= 0 && hour < 24 && minute >= 0 && minute < 60)) throw new Error("--at takes HH:MM");
const hhmm = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

const node = process.execPath;
const daily = fileURLToPath(new URL("./daily.mjs", import.meta.url));
const home = homedir();
const NAME = "xiangqi-triage";

/** Where `claude` is, so the scheduler's PATH includes it (null: not installed here). */
function findClaude() {
  try {
    const out = execFileSync(platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split(/\r?\n/)[0].trim() || null;
  } catch {
    return null;
  }
}
const claude = findClaude();
const path = [...new Set([claude && dirname(claude), dirname(node), ...(process.env.PATH ?? "").split(delimiter)].filter(Boolean))].join(delimiter);

const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** What installing means on each platform: files to write and commands to run (and to undo it). */
function plan() {
  if (platform === "linux") {
    const units = join(home, ".config", "systemd", "user");
    const systemd = (() => {
      try {
        execFileSync("systemctl", ["--user", "show-environment"], { stdio: "ignore" });
        return true;
      } catch {
        return action === "print";
      }
    })();
    if (systemd) {
      return {
        how: "systemd user timer",
        files: {
          [join(units, `${NAME}.service`)]: `[Unit]
Description=Xiangqi School report triage and daily summary
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
Environment=PATH=${path}
ExecStart="${node}" "${daily}"
TimeoutStartSec=45min
`,
          [join(units, `${NAME}.timer`)]: `[Unit]
Description=Run Xiangqi School report triage daily

[Timer]
OnCalendar=*-*-* ${hhmm}:00
Persistent=true
RandomizedDelaySec=10min

[Install]
WantedBy=timers.target
`,
        },
        install: [["systemctl", "--user", "daemon-reload"], ["systemctl", "--user", "enable", "--now", `${NAME}.timer`], ["systemctl", "--user", "list-timers", `${NAME}.timer`, "--no-pager"]],
        uninstall: [["systemctl", "--user", "disable", "--now", `${NAME}.timer`], ["systemctl", "--user", "daemon-reload"]],
        removes: [join(units, `${NAME}.service`), join(units, `${NAME}.timer`)],
        runNow: `systemctl --user start ${NAME}`,
      };
    }
    return { how: "crontab", cron: `${minute} ${hour} * * * PATH='${path}' '${node}' '${daily}' # ${NAME}`, runNow: `node ${daily}` };
  }
  if (platform === "darwin") {
    const plist = join(home, "Library", "LaunchAgents", `com.${NAME.replace("-", ".")}.plist`);
    const uid = process.getuid?.() ?? 501;
    return {
      how: "launchd agent",
      files: {
        [plist]: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.${NAME.replace("-", ".")}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(node)}</string><string>${xml(daily)}</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(path)}</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
</dict>
</plist>
`,
      },
      install: [["launchctl", "bootstrap", `gui/${uid}`, plist]],
      uninstall: [["launchctl", "bootout", `gui/${uid}`, plist]],
      removes: [plist],
      runNow: `launchctl kickstart gui/${uid}/com.${NAME.replace("-", ".")}`,
    };
  }
  if (platform === "win32") {
    const ps = (s) => s.replace(/'/g, "''");
    const register = [
      `$a = New-ScheduledTaskAction -Execute '${ps(node)}' -Argument '"${ps(daily)}"'`,
      `$t = New-ScheduledTaskTrigger -Daily -At '${hhmm}'`,
      `$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 45)`,
      `Register-ScheduledTask -TaskName '${NAME}' -Action $a -Trigger $t -Settings $s -Force | Out-Null`,
      `Get-ScheduledTask -TaskName '${NAME}' | Get-ScheduledTaskInfo`,
    ].join("; ");
    return {
      how: "Task Scheduler task",
      install: [["powershell", "-NoProfile", "-Command", register]],
      uninstall: [["powershell", "-NoProfile", "-Command", `Unregister-ScheduledTask -TaskName '${NAME}' -Confirm:$false`]],
      runNow: `schtasks /Run /TN ${NAME}`,
    };
  }
  throw new Error(`no scheduler known for ${platform}`);
}

const run = (cmd, { ignoreErrors = false } = {}) => {
  try {
    execFileSync(cmd[0], cmd.slice(1), { stdio: "inherit" });
  } catch (e) {
    if (!ignoreErrors) throw e;
  }
};

const p = plan();
if (action === "print") {
  console.log(`On ${platform}: a ${p.how}, daily at ${hhmm}.${claude ? "" : "\n(claude isn't on PATH here: install Claude Code and sign in, or configure another adviser.)"}`);
  for (const [file, text] of Object.entries(p.files ?? {})) console.log(`\n--- ${file}\n${text}`);
  if (p.cron) console.log(`\ncrontab line:\n${p.cron}`);
  for (const c of p.install ?? []) console.log(`\n$ ${c.join(" ")}`);
  console.log(`\nRun once now: ${p.runNow}`);
} else if (action === "install") {
  if (!claude) console.warn("Warning: claude isn't on PATH. The run will fail unless ~/.config/xiangqi-triage.json names another adviser.");
  if (p.cron) {
    let current = "";
    try {
      current = execFileSync("crontab", ["-l"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      // No crontab yet.
    }
    const kept = current.split("\n").filter((l) => l && !l.endsWith(`# ${NAME}`));
    execFileSync("crontab", ["-"], { input: [...kept, p.cron, ""].join("\n") });
  }
  for (const [file, text] of Object.entries(p.files ?? {})) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  if (platform === "darwin") for (const c of p.uninstall) run(c, { ignoreErrors: true });
  for (const c of p.install ?? []) run(c);
  console.log(`Installed: a ${p.how}, daily at ${hhmm}. Run once now with: ${p.runNow}`);
} else if (action === "uninstall") {
  if (p.cron) {
    const current = execFileSync("crontab", ["-l"], { encoding: "utf8" });
    execFileSync("crontab", ["-"], { input: current.split("\n").filter((l) => !l.endsWith(`# ${NAME}`)).join("\n") });
  }
  for (const c of p.uninstall ?? []) run(c, { ignoreErrors: true });
  for (const f of p.removes ?? []) if (existsSync(f)) rmSync(f);
  if (platform === "linux" && !p.cron) run(["systemctl", "--user", "daemon-reload"], { ignoreErrors: true });
  console.log(`Removed the daily triage ${p.how}.`);
} else {
  console.error("Usage: node packages/triage/scripts/schedule.mjs install [--at HH:MM] | uninstall | print [--platform linux|darwin|win32]");
  process.exit(2);
}
