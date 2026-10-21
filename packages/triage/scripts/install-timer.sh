#!/usr/bin/env bash
# Installs (or with --uninstall removes) a systemd user timer that runs report triage once a day
# at 07:30, and at the next log-in if the PC was off then (Persistent=true). It uses Claude Code
# on this account's own subscription, so `claude` must be signed in. docs/v0.4-design.md, M22.
#
#   packages/triage/scripts/install-timer.sh            install and start
#   packages/triage/scripts/install-timer.sh --uninstall
#   systemctl --user start xiangqi-triage               run once now
#   journalctl --user -u xiangqi-triage                 what it did
set -euo pipefail
units=$HOME/.config/systemd/user
if [[ ${1:-} == --uninstall ]]; then
  systemctl --user disable --now xiangqi-triage.timer 2>/dev/null || true
  rm -f "$units/xiangqi-triage.service" "$units/xiangqi-triage.timer"
  systemctl --user daemon-reload
  echo "Removed the daily triage timer."
  exit 0
fi
here=$(cd "$(dirname "$0")" && pwd)
claude=$(command -v claude || true)
if [[ -z $claude ]]; then
  echo "Claude Code (claude) isn't on PATH; install it and sign in first." >&2
  exit 1
fi
mkdir -p "$units"
cat > "$units/xiangqi-triage.service" <<UNIT
[Unit]
Description=Xiangqi School report triage and daily summary
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
Environment=PATH=$(dirname "$claude"):$HOME/.local/node/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$here/run-daily.sh
TimeoutStartSec=45min
UNIT
cat > "$units/xiangqi-triage.timer" <<UNIT
[Unit]
Description=Run Xiangqi School report triage daily

[Timer]
OnCalendar=*-*-* 07:30:00
Persistent=true
RandomizedDelaySec=10min

[Install]
WantedBy=timers.target
UNIT
chmod +x "$here/run-daily.sh"
systemctl --user daemon-reload
systemctl --user enable --now xiangqi-triage.timer
systemctl --user list-timers xiangqi-triage.timer --no-pager
