#!/usr/bin/env bash
# The daily triage run the timer starts (install-timer.sh): verdicts on open reports, any
# automatic steps they take, then the summary for the review page. Output goes to the journal:
#   journalctl --user -u xiangqi-triage
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
node=${XQ_NODE:-$HOME/.local/node/bin/node}
token_file=${XQ_TOKEN_FILE:-$HOME/.config/xiangqi-supabase-token}
if [[ ! -r $token_file ]]; then
  echo "No Supabase access token at $token_file" >&2
  exit 1
fi
cd "$repo"
SUPABASE_ACCESS_TOKEN=$(tr -d '\n' < "$token_file") exec "$node" packages/triage/scripts/triage.mjs "$@"
