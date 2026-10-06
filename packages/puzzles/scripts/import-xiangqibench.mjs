// Import classical composed endgames from XiangqiBench (MIT; the positions come from 适情雅趣,
// 1570, and the 江湖 street-endgame collection, both public domain) as mate puzzles.
// The source has no solution lines, so the engine builds them: at each step the solver's move
// must be a mate that no other move matches in speed (a mate two or more moves slower is
// allowed), the defender plays the engine's longest resistance, and the line ends in mate.
// Positions that fail are skipped. Usage: node scripts/import-xiangqibench.mjs [out]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Game } from "../../xiangqi-core/dist/index.js";
import { isMate, mateIn, startEngine } from "./engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "../../../content/puzzles/sources/xiangqibench-cases.jsonl");
const OUT = process.argv[2] ?? join(here, "../../../content/puzzles/classical.jsonl");
const DEPTH = 20;
const MAX_MOVES = 7;

const engine = await startEngine({ hash: 128 });
const cases = readFileSync(SRC, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const out = [];
const why = {};
const skip = (reason) => (why[reason] = (why[reason] ?? 0) + 1);

for (const c of cases) {
  try {
    if (new Game(c.fen).result) {
      skip("already over");
      continue;
    }
  } catch {
    skip("illegal FEN");
    continue;
  }
  const solution = [];
  let fen = c.fen;
  let ok = false;
  let stalemate = false;
  for (let k = 0; k < MAX_MOVES; k++) {
    const [best, second] = await engine.analyze(fen, DEPTH, 2);
    if (!best || !isMate(best.cp)) {
      skip(k === 0 ? "no forced mate found" : "mate lost on the way");
      break;
    }
    if (second && isMate(second.cp) && mateIn(second.cp) < mateIn(best.cp) + 2) {
      skip(k === 0 ? "first move not unique" : "later move not unique");
      break;
    }
    const g = new Game(fen);
    if (!g.move(best.move)) break;
    solution.push(best.move);
    if (g.result) {
      ok = g.result.reason === "checkmate" || g.result.reason === "stalemate";
      stalemate = g.result.reason === "stalemate";
      if (!ok) skip(`ends by ${g.result.reason}`);
      break;
    }
    const [reply] = await engine.analyze(g.fen, DEPTH - 2, 1);
    if (!reply || !g.move(reply.move)) break;
    solution.push(reply.move);
    fen = g.fen;
  }
  if (!ok) continue;
  const n = (solution.length + 1) / 2;
  out.push({
    id: createHash("sha1").update(c.fen).digest("hex").slice(0, 10),
    fen: c.fen,
    solution,
    rating: 1000,
    themes: [stalemate ? "stalemate" : `mateIn${Math.min(n, 9)}`, n === 1 ? "oneMove" : n === 2 ? "short" : "long", "classical"],
    source: `xiangqibench:${c.id}`,
    name: c.name,
  });
  console.log(`${c.id}: mate in ${n}`);
}
engine.quit();
writeFileSync(OUT, out.map((p) => JSON.stringify(p)).join("\n") + "\n");
console.log(`${out.length}/${cases.length} imported → ${OUT}`, why);
