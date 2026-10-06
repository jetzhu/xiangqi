// Re-check every puzzle with native Pikafish at a fixed depth: each solver move must still be
// the engine's best (or, on the last move of a mate puzzle, any mating move) and must stand
// out from the second best: by ≥ 150 cp, or for a mate, no other move may mate within one
// move as fast. Prints failures; exit code 1 if any.
// Usage: node scripts/verify.mjs [depth=16] [file=content/puzzles/puzzles.jsonl]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Game } from "../../xiangqi-core/dist/index.js";
import { isMate, mateIn, startEngine } from "./engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DEPTH = Number(process.argv[2] ?? 16);
const FILE = process.argv[3] ?? join(here, "../../../content/puzzles/puzzles.jsonl");
const puzzles = readFileSync(FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const engine = await startEngine({ hash: 128 });

let bad = 0;
const failed = [];
for (const [n, pz] of puzzles.entries()) {
  const g = new Game(pz.fen);
  for (let i = 0; i < pz.solution.length; i += 2) {
    const [a, b] = await engine.analyze(g.fen, DEPTH, 2);
    const want = pz.solution[i];
    const lastMate = i === pz.solution.length - 1 && pz.themes.some((t) => t.startsWith("mateIn"));
    const best = a && (a.move === want || (lastMate && isMate(a.cp)));
    const standsOut =
      !b || lastMate || (isMate(a.cp) ? !isMate(b.cp) || mateIn(b.cp) >= mateIn(a.cp) + 2 : a.cp - b.cp >= 150);
    if (!best || !standsOut) {
      bad++;
      failed.push(pz.id);
      console.log(`FAIL ${pz.id} move ${i + 1}: want ${want}, engine ${a?.move} (${a?.cp}) vs ${b?.move} (${b?.cp})`);
      break;
    }
    g.move(want);
    if (i + 1 < pz.solution.length) g.move(pz.solution[i + 1]);
  }
  if ((n + 1) % 50 === 0) console.log(`${n + 1}/${puzzles.length} checked, ${bad} failed`);
}
console.log(`verified ${puzzles.length} puzzles at depth ${DEPTH}: ${bad} failed`);
if (failed.length) console.log(`FAILED_IDS ${failed.join(",")}`);
engine.quit();
process.exit(bad ? 1 : 0);
