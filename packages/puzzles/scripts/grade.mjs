// Grade puzzles by what makes a Xiangqi tactic hard, not just by its length (scheme from a
// coach's review, see content/puzzles/README.md):
//   D = (solver moves − 1)
//     + 2 per quiet solver move (no check, no capture), +2 more if the first move is quiet
//     + 1.5 per sacrifice (2 if a chariot is given up)
//     + 1 per decoy: a check or capture at the start that looks natural but leaves the solver
//       no longer winning (below +150 cp) (max 3)
//     + 1 if a motif appears: discovered check, or a cannon screen made by the moving piece
//     + 1 if the defender has 3 or more replies at some point
//     − 1 if every solver move is a check and the defender always has a single reply
// Floors and caps by mate length (the product owner's tiers, which the coach agreed with for
// mates): mate in 1 is always Beginner; mate in 2+ at least Standard; mate in 4+ at least Hard.
// Level: Beginner D < 2, Standard 2 to < 5, Hard 5 to < 8, Extra hard ≥ 8. Rating seed: 600 + 100·D.
// Writes rating and themes back into the file(s). Usage: node scripts/grade.mjs file.jsonl…
import { readFileSync, writeFileSync } from "node:fs";
import { Game, Position, toIccs } from "../../xiangqi-core/dist/index.js";
import { startEngine } from "./engine.mjs";

const VALUE = { k: 0, a: 2, b: 2, n: 4, r: 9, c: 4.5, p: 1 };
const FILES = "abcdefghi";
const sq = (name) => FILES.indexOf(name[0]) + 9 * Number(name[1]);

// --- Engine: score of one move (searchmoves), from the mover's side ----------------------
const engine = await startEngine();
async function score(fen, depth, move) {
  const [l] = await engine.analyze(fen, depth, 1, move ? [move] : []);
  return l?.cp ?? 0;
}

// --- Board features --------------------------------------------------------------------------
function material(fen, red) {
  const p = Position.fromFen(fen);
  let m = 0;
  p.board.forEach((c, s) => {
    if (!c) return;
    const type = " kabnrcp"[Math.abs(c)];
    let v = VALUE[type];
    if (type === "p" && (c > 0 ? Math.floor(s / 9) >= 5 : Math.floor(s / 9) <= 4)) v = 2; // crossed the river
    m += (c > 0) === red ? v : -v;
  });
  return m;
}
const targets = (p, s) => p.pieceMoves(s).map((m) => m >> 7);
/** After a checking move to `to`: is the check given by another piece (discovered)? */
function discovered(fenAfter, to) {
  const p = Position.fromFen(fenAfter);
  const enemyKing = p.kings[p.turn === 1 ? 0 : 1];
  return !targets(p, sq(to)).includes(enemyKing);
}
/** Does one of the mover's cannons now check through the piece that just moved? */
function cannonScreen(fenAfter, to) {
  const p = Position.fromFen(fenAfter);
  const enemyKing = p.kings[p.turn === 1 ? 0 : 1];
  const mover = p.turn === 1 ? -1 : 1; // the side that just moved
  const screen = sq(to);
  return p.board.some((c, s) => {
    if (c !== 6 * mover || !targets(p, s).includes(enemyKing)) return false;
    const [a, b] = [Math.min(s, enemyKing), Math.max(s, enemyKing)];
    const step = s % 9 === enemyKing % 9 ? 9 : 1;
    for (let t = a + step; t < b; t += step) if (t === screen) return true;
    return false;
  });
}

export async function grade(puzzle) {
  const red = puzzle.fen.split(" ")[1] !== "b";
  const g = new Game(puzzle.fen);
  const themes = new Set(puzzle.themes.filter((t) => !["quiet", "sacrifice", "discoveredCheck", "cannonScreen", "decoy"].includes(t)));
  let D = (puzzle.solution.length + 1) / 2 - 1;
  let allChecks = true;
  let singleReplies = true;
  let branching = false;
  let motif = false;
  for (let i = 0; i < puzzle.solution.length; i += 2) {
    const before = g.fen;
    const rec = g.move(puzzle.solution[i]);
    if (!rec) throw new Error(`${puzzle.id}: illegal ${puzzle.solution[i]}`);
    if (!rec.check) allChecks = false;
    if (!rec.check && !rec.captured) {
      D += i === 0 ? 4 : 2;
      themes.add("quiet");
    }
    if (rec.check && discovered(g.fen, puzzle.solution[i].slice(2))) (motif = true), themes.add("discoveredCheck");
    if (rec.check && cannonScreen(g.fen, puzzle.solution[i].slice(2))) (motif = true), themes.add("cannonScreen");
    const reply = puzzle.solution[i + 1];
    if (!reply) break;
    const replies = g.legalMoves().length;
    if (replies >= 3) branching = true;
    if (replies !== 1) singleReplies = false;
    const r = g.move(reply);
    // A sacrifice: the reply takes material and the solver is down on the exchange.
    if (r?.captured && material(g.fen, red) - material(before, red) <= -1.5) {
      D += r.captured === "r" ? 2 : 1.5;
      themes.add("sacrifice");
    }
  }
  if (motif) D += 1;
  if (branching) D += 1;
  if (allChecks && singleReplies && puzzle.solution.length > 1) D -= 1;

  // Decoys: natural-looking checks and captures at the start after which the solver is no
  // longer winning. (Measured against "still winning", not against the best move: next to a
  // mate every other move is worse, but a check that still wins easily isn't a trap.)
  const start = new Game(puzzle.fen);
  let decoys = 0;
  for (const m of start.legalMoves().map(toIccs)) {
    if (m === puzzle.solution[0]) continue;
    const t = new Game(puzzle.fen);
    const rec = t.move(m);
    if (!rec || (!rec.check && !rec.captured)) continue;
    if ((await score(puzzle.fen, 10, m)) < 150) decoys++;
    if (decoys === 3) break;
  }
  if (decoys) themes.add("decoy");
  D += decoys;

  D = Math.max(0, D);
  const mate = puzzle.themes.find((t) => /^mateIn\d+$/.test(t));
  const mateN = mate ? Number(mate.slice(6)) : 0;
  if (mateN === 1) D = Math.min(D, 1.5);
  else if (mateN >= 4) D = Math.max(D, 5);
  else if (mateN >= 2) D = Math.max(D, 2);
  const level = D < 2 ? "beginner" : D < 5 ? "standard" : D < 8 ? "hard" : "extraHard";
  return { ...puzzle, rating: Math.min(2400, Math.round(600 + 100 * D)), themes: [...themes], difficulty: { D, level } };
}

for (const file of process.argv.slice(2)) {
  const puzzles = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const out = [];
  for (const [i, p] of puzzles.entries()) {
    out.push(await grade(p));
    if ((i + 1) % 25 === 0) console.log(`${file}: ${i + 1}/${puzzles.length}`);
  }
  writeFileSync(file, out.map((p) => JSON.stringify(p)).join("\n") + "\n");
  const by = {};
  for (const p of out) by[p.difficulty.level] = (by[p.difficulty.level] ?? 0) + 1;
  console.log(file, by);
}
engine.quit();
