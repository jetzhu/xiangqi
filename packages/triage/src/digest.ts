// The daily summary for the review page (docs/v0.4-design.md, M22): the numbers come from the
// database as they are; an adviser, when there is one, adds the feedback's themes and anything
// that looks unusual. If the adviser fails, the numbers are saved on their own.
import type { Adviser, DigestInput } from "./types.js";

export const DIGEST_SYSTEM = `You write a short daily note for the volunteer moderators of a free Xiangqi (Chinese chess) website.
You get the day's figures and the feedback players sent, as JSON. Write Markdown with at most two sections, and nothing else:
"### Feedback themes": group the feedback into themes (problems first), each a bullet with how many messages and their ids in brackets, e.g. "- The clock freezes after a reconnect (2) [14, 17]". Write in English; translate Chinese feedback. Quote nothing personal.
"### Worth a look": only if something is unusual (a burst of reports against the 30-day average, a category switched off, steps waiting more than 3 days). One bullet each.
Leave out a section with nothing in it. Never invent figures. Keep it under 250 words.`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The figures, as Markdown, without any adviser. */
export function digestFigures(d: DigestInput, now = new Date()): string {
  const total = d.steps.reduce((a, s) => a + s.n, 0);
  const by = (key: "kind" | "source") =>
    Object.entries(d.steps.reduce<Record<string, number>>((a, s) => ((a[s[key]] = (a[s[key]] ?? 0) + s.n), a), {}))
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");
  const off = Object.entries(d.switches)
    .filter(([, v]) => v < 1)
    .map(([k]) => k.replace(/^auto_/, ""));
  const lines = [
    `## Triage summary, ${now.toISOString().slice(0, 10)}`,
    "",
    `Since ${d.since.slice(0, 16).replace("T", " ")} UTC:`,
    "",
    `- **${plural(total, "automatic step")}**${total ? ` (${by("kind")}; by ${by("source")})` : ""}.`,
    `- **${plural(d.waiting_review, "step")} waiting for your look**${d.oldest_waiting ? `, the oldest from ${d.oldest_waiting.slice(0, 10)}` : ""}.`,
    `- ${plural(d.open_reports, "open report")} on ${plural(d.players_with_open_reports, "player")}; ${plural(d.reports_made, "report")} made (30-day average ${d.reports_per_day_30d} a day).`,
    ...d.switched_off.map((s) => `- **Switched itself off:** ${s.category} (${s.note}).`),
    `- Automatic steps ${off.length ? `off for: ${off.join(", ")}` : "on for every category"}.`,
    `- ${plural(d.feedback.length, "new feedback message")}; ${d.feedback_open} not yet filed.`,
  ];
  return lines.join("\n");
}

/** The whole summary: the figures, then the adviser's themes and notes (when it can). */
export async function writeDigest(d: DigestInput, adviser: Adviser | null, log: (line: string) => void = () => {}): Promise<string> {
  const figures = digestFigures(d);
  const quiet = d.feedback.length === 0 && d.switched_off.length === 0 && d.reports_made <= Math.max(3, 3 * d.reports_per_day_30d);
  if (!adviser?.complete || quiet) return figures;
  try {
    const notes = (await adviser.complete(DIGEST_SYSTEM, JSON.stringify(d, null, 2), 1200)).trim();
    return notes ? `${figures}\n\n${notes.slice(0, 6000)}` : figures;
  } catch (e) {
    log(`summary notes skipped (${e instanceof Error ? e.message : String(e)})`);
    return `${figures}\n\n_(The adviser couldn't add notes this time.)_`;
  }
}
