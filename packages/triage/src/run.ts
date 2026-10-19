// One triage run: every open report the adviser hasn't seen since it last changed gets a
// verdict, stored as "ai:<adviser>" beside the rules' on the review page. Advice only: nothing
// here changes a report, a player or a game.
import type { Store } from "./store.js";
import type { Adviser } from "./types.js";

export interface RunResult {
  advised: number;
  failed: { report: number; error: string }[];
}

export async function runTriage(o: { adviser: Adviser; store: Store; limit?: number; dryRun?: boolean; log?: (line: string) => void }): Promise<RunResult> {
  const source = `ai:${o.adviser.name}`;
  const log = o.log ?? (() => {});
  const cases = await o.store.pending(source, o.limit ?? 20);
  const out: RunResult = { advised: 0, failed: [] };
  for (const c of cases) {
    try {
      const advice = await o.adviser.advise(c);
      log(`report ${c.report} (${c.reason}, ${c.suspect}): ${advice.verdict} ${advice.confidence.toFixed(2)} · ${advice.reason}`);
      if (!o.dryRun) await o.store.save(c.report, source, advice, o.adviser.model ?? o.adviser.name);
      out.advised++;
    } catch (e) {
      // One bad answer doesn't stop the run; the report is tried again next time.
      const error = e instanceof Error ? e.message : String(e);
      log(`report ${c.report}: skipped (${error})`);
      out.failed.push({ report: c.report, error });
    }
  }
  return out;
}
