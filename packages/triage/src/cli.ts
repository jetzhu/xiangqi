// The triage command (scripts/triage.mjs runs it):
//   SUPABASE_ACCESS_TOKEN=… node packages/triage/scripts/triage.mjs [--dry-run] [--limit N]
// Reads the adviser from the config (config.ts), triages the open reports, prints each verdict.
import { adviserFrom, loadConfig } from "./config.js";
import { runTriage } from "./run.js";
import { managementStore } from "./store.js";

export async function main(argv: string[], env: Record<string, string | undefined>, ref: string) {
  const dryRun = argv.includes("--dry-run");
  const i = argv.indexOf("--limit");
  const config = loadConfig(env);
  const limit = i >= 0 ? Number(argv[i + 1]) : (config.limit ?? 20);
  const token = env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("Set SUPABASE_ACCESS_TOKEN (a personal access token from supabase.com/dashboard/account/tokens).");
  const adviser = adviserFrom(config, env);
  console.log(`Triage with ${adviser.name}${adviser.model ? ` (${adviser.model})` : ""}${dryRun ? ", dry run: nothing is saved" : ""}`);
  const r = await runTriage({ adviser, store: managementStore({ token, ref }), limit, dryRun, log: (l) => console.log(l) });
  console.log(`${r.advised} advised, ${r.failed.length} skipped.`);
}
