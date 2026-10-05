// Re-check every puzzle with native Pikafish at a fixed depth: each solver move must still be
// the engine's best (or, on the last move of a mate puzzle, any mating move) and must stand
// out from the second-best by the generator's margin. Prints failures; exit code 1 if any.
// Usage: node scripts/verify.mjs [depth=16]
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Game } from "../../xiangqi-core/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const DEPTH = Number(process.argv[2] ?? 16);
const ENGINE = process.env.PIKAFISH ?? join(here, "../../../spikes/engine/vendor/pikafish-native/pikafish");
const puzzles = readFileSync(join(here, "../../../content/puzzles/generated.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const p = spawn(ENGINE, [], { cwd: dirname(ENGINE) });
let buf = "";
let waiter = null;
let collected = [];
p.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const l = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    collected.push(l);
    if (waiter?.(l)) {
      waiter = null;
    }
  }
});
const send = (c) => p.stdin.write(c + "\n");
const until = (test) => new Promise((resolve) => (waiter = (l) => (test(l) ? (resolve(collected.splice(0)), true) : false)));
send("uci");
await until((l) => l === "uciok");
send("setoption name MultiPV value 2");
send("isready");
await until((l) => l === "readyok");

async function top2(fen) {
  send(`position fen ${fen}`);
  send(`go depth ${DEPTH}`);
  const out = await until((l) => l.startsWith("bestmove"));
  const last = new Map();
  for (const l of out) {
    if (!l.startsWith(`info depth ${DEPTH} `) || / (lower|upper)bound/.test(l)) continue;
    const k = Number(/ multipv (\d+)/.exec(l)[1]);
    const mate = / score mate (-?\d+)/.exec(l);
    last.set(k, { move: / pv (\S+)/.exec(l)[1], cp: mate ? Math.sign(+mate[1]) * (30000 - 100 * Math.abs(+mate[1])) : +/ score cp (-?\d+)/.exec(l)[1] });
  }
  return [last.get(1), last.get(2)];
}

let bad = 0;
for (const [n, pz] of puzzles.entries()) {
  const g = new Game(pz.fen);
  for (let i = 0; i < pz.solution.length; i += 2) {
    const [a, b] = await top2(g.fen);
    const want = pz.solution[i];
    const lastMate = i === pz.solution.length - 1 && pz.themes.some((t) => t.startsWith("mateIn"));
    const ok = a && (a.move === want || (lastMate && a.cp > 20000)) && (!b || a.cp - b.cp >= 150 || (a.cp > 20000 && b.cp < 20000) || lastMate);
    if (!ok) {
      bad++;
      console.log(`FAIL ${pz.id} move ${i + 1}: want ${want}, engine ${a?.move} (${a?.cp}) vs ${b?.move} (${b?.cp})`);
      break;
    }
    g.move(want);
    if (i + 1 < pz.solution.length) g.move(pz.solution[i + 1]);
  }
  if ((n + 1) % 50 === 0) console.log(`${n + 1}/${puzzles.length} checked, ${bad} failed`);
}
console.log(`verified ${puzzles.length} puzzles at depth ${DEPTH}: ${bad} failed`);
send("quit");
process.exit(bad ? 1 : 0);
