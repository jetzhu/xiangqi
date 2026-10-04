// Cross-check xiangqi-core move generation against Fairy-Stockfish ("go perft").
// Compares per-move (divide) counts on hand-picked and random positions and prints
// any mismatch. Also prints PERFT_CASES entries to paste into test/perft-cases.ts.
//
// Usage: pnpm build && node scripts/crosscheck.mjs [randomGames=40] [depth=3]

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Position, moveFrom, moveTo, squareName } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const games = Number(process.argv[2] ?? 40);
const depth = Number(process.argv[3] ?? 3);

// Fairy-Stockfish from the engine spike package.
const spike = join(here, "../../../spikes/engine/");
const require = createRequire(spike + "x.js");
const dir = dirname(require.resolve("fairy-stockfish-nnue.wasm/package.json"));
const sf = await require(join(dir, "stockfish.js"))({ wasmBinary: readFileSync(join(dir, "stockfish.wasm")) });
let lines = [];
let waiter = null;
sf.addMessageListener((l) => {
  lines.push(l);
  if (waiter && waiter.test(l)) {
    const w = waiter;
    waiter = null;
    w.resolve();
  }
});
const until = (test) => new Promise((resolve) => (waiter = { test, resolve }));
sf.postMessage("uci");
sf.postMessage("setoption name UCI_Variant value xiangqi");
sf.postMessage("isready");
await until((l) => l === "readyok");

// Fairy-Stockfish numbers ranks 1–10; ICCS uses 0–9.
const toIccs = (m) => m.replace(/([a-i])(10|[1-9])/g, (_, f, r) => f + (Number(r) - 1));

async function fsfDivide(fen, d) {
  lines = [];
  sf.postMessage(`position fen ${fen}`);
  sf.postMessage(`go perft ${d}`);
  await until((l) => l.startsWith("Nodes searched"));
  const divide = new Map();
  for (const l of lines) {
    const m = /^([a-i]\d+[a-i]\d+): (\d+)$/.exec(l);
    if (m) divide.set(toIccs(m[1]), Number(m[2]));
  }
  return divide;
}

function ourDivide(fen, d) {
  const p = Position.fromFen(fen);
  const divide = new Map();
  for (const m of p.legalMoves()) {
    const u = p.make(m);
    divide.set(squareName(moveFrom(m)) + squareName(moveTo(m)), p.perft(d - 1));
    p.unmake(m, u);
  }
  return divide;
}

const HAND = {
  "stalemate (black to move, no legal move)": "4k4/9/6N2/9/9/9/9/9/3R1R3/3K5 b - - 0 1",
  "checkmate (chariot on the back rank)": "R3k4/9/6N2/9/9/9/9/9/5R3/3K5 b - - 0 1",
  "pinned by the flying general": "4k4/9/9/9/4c4/9/9/4R4/9/4K4 w - - 0 1",
  "cannon screens and horse legs": "r1bakab1r/9/1cn3nc1/p1p1C1p1p/9/9/P1P1P1P1P/2N4C1/9/R1BAKABNR b - - 0 1",
  "crossed soldiers": "3k5/4a4/2P1P1P2/9/4p4/2p6/9/9/4A4/3AK4 w - - 0 1",
};

// Random games with a seeded generator so runs are repeatable.
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const randomFens = [];
for (let g = 0; g < games; g++) {
  const p = Position.fromFen("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1");
  const plies = 10 + Math.floor(rnd() * 90);
  for (let i = 0; i < plies; i++) {
    const ms = p.legalMoves();
    if (ms.length === 0) break;
    p.make(ms[Math.floor(rnd() * ms.length)]);
  }
  randomFens.push(p.toFen());
}

let mismatches = 0;
const cases = [];
const all = [...Object.entries(HAND), ...randomFens.map((f, i) => [`random game ${i + 1}`, f])];
for (const [name, fen] of all) {
  const theirs = await fsfDivide(fen, depth);
  const ours = ourDivide(fen, depth);
  const keys = new Set([...theirs.keys(), ...ours.keys()]);
  const bad = [...keys].filter((k) => theirs.get(k) !== ours.get(k));
  if (bad.length) {
    mismatches++;
    console.log(`MISMATCH ${name}: ${fen}`);
    for (const k of bad.slice(0, 10)) console.log(`  ${k}: fairy=${theirs.get(k)} ours=${ours.get(k)}`);
  }
  if (!name.startsWith("random") || cases.length < 10) {
    const counts = [];
    for (let d = 1; d <= depth; d++) counts.push([...(await fsfDivide(fen, d)).values()].reduce((a, b) => a + b, 0));
    cases.push({ name, fen, counts });
  }
}
console.log(`\n${all.length} positions checked at depth ${depth}: ${mismatches} mismatches`);
console.log("\nexport const PERFT_CASES = " + JSON.stringify(cases, null, 2) + ";");
process.exit(mismatches ? 1 : 0);
