// One triage run: every open report the adviser hasn't seen since it last changed gets a
// verdict, stored as "ai:<adviser>" beside the rules' on the review page. The database decides
// whether a verdict may take an automatic step (triage_auto_act); then the daily summary.
import { writeDigest } from "./digest.js";
import type { Store } from "./store.js";
import type { Adviser } from "./types.js";

export interface RunResult {
  advised: number;
  /** Automatic steps the verdicts took. */
  steps: number;
  failed: { report: number; error: string }[];
}

export async function runTriage(o: { adviser: Adviser; store: Store; limit?: number; dryRun?: boolean; log?: (line: string) => void }): Promise<RunResult> {
  const source = `ai:${o.adviser.name}`;
  const log = o.log ?? (() => {});
  const cases = await o.store.pending(source, o.limit ?? 20);
  const out: RunResult = { advised: 0, steps: 0, failed: [] };
  for (const c of cases) {
    try {
      const advice = await o.adviser.advise(c);
      log(`report ${c.report} (${c.reason}, ${c.suspect}): ${advice.verdict} ${advice.confidence.toFixed(2)} · ${advice.reason}`);
      if (!o.dryRun) {
        const step = await o.store.save(c.report, source, advice, o.adviser.model ?? o.adviser.name);
        if (step !== null) {
          out.steps++;
          log(`  took step #${step}`);
        }
      }
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

/** Writes the daily summary and saves it (or, in a dry run, only prints it). */
export async function runDigest(o: { adviser: Adviser | null; store: Store; dryRun?: boolean; log?: (line: string) => void }): Promise<string> {
  const log = o.log ?? (() => {});
  const input = await o.store.digestInput();
  const summary = await writeDigest(input, o.adviser, log);
  const { feedback: _feedback, ...stats } = input;
  if (!o.dryRun) await o.store.saveDigest(o.adviser ? `ai:${o.adviser.name}` : "figures", summary, { ...stats, feedback_new: input.feedback.length });
  return summary;
}
