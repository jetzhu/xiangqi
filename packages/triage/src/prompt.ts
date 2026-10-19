// The instructions every adviser gets, and reading its answer. One prompt for every provider,
// so their verdicts can be compared on the review page.
import type { Advice, TriageCase } from "./types.js";

export const SYSTEM = `You help the volunteer moderators of a free Xiangqi (Chinese chess) website triage player reports.
Each report is about the opponent ("suspect") in one finished online game. Give a first opinion only: a person makes every decision that affects a player.

What the site records:
- Chat is preset phrases only (hello, luck = "Good luck", gg = "Good game", thanks, well = "Well played", oops, wow, bye). Abuse means spamming or taunting with them, for example "wow" or "oops" after each of the opponent's mistakes, or many phrases in a row. Both players' browsers record the chat; if the two records differ, one browser left something out or added it.
- Sportsmanship labels on the game: "stalled" (let the clock run out in a lost position), "abandoned" (left), "aborted", "slow-start". They come from the server's own clock.
- Fair-play standing at the game's speed: a statistical comparison of the suspect's accuracy with honest players of the same rating, over many games. "likely" is strong evidence, "watch" is weak, "normal" with 10 or more games is evidence against engine use. One game proves nothing.
- The rules' verdict: simple automatic checks that already ran. Agree or disagree with them on the evidence.

Answer with one JSON object and nothing else:
{"verdict": "valid" | "invalid" | "inconclusive", "confidence": number from 0 to 1, "reason": "one or two plain sentences citing the evidence"}
"valid": the evidence supports the report. "invalid": it contradicts it. "inconclusive": not enough evidence either way. Use "inconclusive" when unsure; never guess. Usernames: "valid" only if offensive (slurs, sexual, hateful or harassing), not merely odd.`;

/** The case as the adviser reads it. */
export const casePrompt = (c: TriageCase) => `Report to triage:\n${JSON.stringify(c, null, 2)}`;

const VERDICTS = new Set(["valid", "invalid", "inconclusive"]);

/**
 * Reads an adviser's answer: the first JSON object in the text, checked. Throws if there isn't a
 * usable one, so a confused answer is skipped rather than stored.
 */
export function parseAdvice(text: string): Advice {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the answer");
  const x = JSON.parse(text.slice(start, end + 1)) as Partial<Advice>;
  if (!x || !VERDICTS.has(x.verdict as string)) throw new Error("no valid verdict");
  const confidence = Number(x.confidence);
  if (!Number.isFinite(confidence)) throw new Error("no confidence");
  const reason = typeof x.reason === "string" ? x.reason.trim() : "";
  if (!reason) throw new Error("no reason");
  return { verdict: x.verdict as Advice["verdict"], confidence: Math.min(1, Math.max(0, confidence)), reason: reason.slice(0, 500) };
}
