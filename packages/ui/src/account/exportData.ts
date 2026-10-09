// "Download my data" (M14): everything the account holds, as one JSON file. GDPR and PIPL give
// players the right to a copy. Read with the player's own session, so row-level security
// limits it to their rows.
import type { SupabaseClient } from "@supabase/supabase-js";

const TABLES = ["profiles", "settings", "lesson_progress", "player_state", "analyses", "bot_games", "puzzle_attempts", "ratings"] as const;
/** The API returns at most 1000 rows per request. */
const PAGE = 1000;

export async function exportAccount(sb: SupabaseClient, user: { id: string; email: string }): Promise<Blob> {
  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email },
  };
  for (const table of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(table).select("*").range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < PAGE) break;
    }
    out[table] = rows;
  }
  return new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
}

/** Saves a file through the browser's download. */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
