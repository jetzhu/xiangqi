// Offline puzzle generator.
//
// 1. Self-play: Pikafish plays itself, sampling among its top lines (and occasionally a
//    random move) so that realistic mistakes happen.
// 2. Mining: when a move turns a roughly level position into a clearly winning one for the
//    opponent, the position after it becomes a puzzle candidate.
// 3. Solving: from the candidate, the solver's moves must each be the only clearly winning
//    move (big gap to the second-best); the opponent replies with the engine's best. The
//    line ends at mate or once material is won and the win is confirmed after the reply.
// 4. Difficulty: the shallowest depth at which the engine finds the first move, plus length.
//
// Usage:
//   node scripts/generate.mjs --games 40 --workers 3 --seed 1 --out ../../content/puzzles/generated.jsonl
//   --hard: aim at harder puzzles — also mine positions where a forced mate in 2–7 has just
//   appeared, allow solutions of up to 7 solver moves, search deeper, and skip one-movers.
// Needs a native Pikafish binary + net (see spikes/engine/build-pikafish.sh); set PIKAFISH=path.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Game, Position, START_FEN, parseIccs, toIccs } from "../../xiangqi-core/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const GAMES = Number(arg("games", 20));
const WORKERS = Number(arg("workers", 2));
const SEED = Number(arg("seed", 1));
const OUT = arg("out", join(here, "../../../content/puzzles/generated.jsonl"));
const HARD = process.argv.includes("--hard");
const MAX_SOLVER_MOVES = HARD ? 7 : 3;
const DEPTH = HARD ? 16 : 14;
const ENGINE = process.env.PIKAFISH ?? join(here, "../../../spikes/engine/vendor/pikafish-native/pikafish");

// --- A small UCI client for a native engine ------------------------------------------------
function startEngine() {
  const p = spawn(ENGINE, [], { cwd: dirname(ENGINE) });
  let buf = "";
  let waiter = null;
  const lines = [];
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const l = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      lines.push(l);
      if (waiter && waiter.test(l)) {
        const w = waiter;
        waiter = null;
        w.resolve([...lines]);
        lines.length = 0;
      }
    }
  });
  const send = (c) => p.stdin.write(c + "\n");
  const until = (test) => new Promise((resolve) => (waiter = { test, resolve }));
  return {
    async init() {
      send("uci");
      await until((l) => l === "uciok");
      send("setoption name Threads value 1");
      send("setoption name Hash value 64");
      send("isready");
      await until((l) => l === "readyok");
    },
    /** Lines sorted by MultiPV: { move, cp } with cp from the side to move (mate → ±(30000 − 100·n)). */
    async analyze(fen, depth, multipv = 1) {
      send(`setoption name MultiPV value ${multipv}`);
      send(`position fen ${fen}`);
      send(`go depth ${depth}`);
      const out = await until((l) => l.startsWith("bestmove"));
      const byPv = new Map();
      for (const l of out) {
        if (!l.startsWith("info") || !l.includes(" pv ") || / (lower|upper)bound/.test(l)) continue;
        const d = Number(/ depth (\d+)/.exec(l)?.[1]);
        const k = Number(/ multipv (\d+)/.exec(l)?.[1] ?? 1);
        const mate = / score mate (-?\d+)/.exec(l);
        const cp = mate ? Math.sign(Number(mate[1])) * (30000 - 100 * Math.abs(Number(mate[1]))) : Number(/ score cp (-?\d+)/.exec(l)?.[1]);
        const move = / pv (\S+)/.exec(l)[1];
        const prev = byPv.get(k);
        if (!prev || d >= prev.depth) byPv.set(k, { depth: d, cp, move, mate: mate ? Number(mate[1]) : null });
      }
      return [...byPv.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    },
    quit() {
      send("quit");
    },
  };
}

// --- Helpers -------------------------------------------------------------------------------
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Rough piece values for "material won".
const VALUE = { 1: 0, 2: 2, 3: 2, 4: 4, 5: 9, 6: 4.5, 7: 1 };
function material(fen, red) {
  const p = Position.fromFen(fen);
  let m = 0;
  p.board.forEach((c, s) => {
    if (!c) return;
    let v = VALUE[Math.abs(c)];
    if (Math.abs(c) === 7 && (c > 0 ? Math.floor(s / 9) >= 5 : Math.floor(s / 9) <= 4)) v = 2; // crossed soldier
    m += (c > 0) === red ? v : -v;
  });
  return m;
}
const sideRed = (fen) => fen.split(" ")[1] !== "b";
// Mate scores are encoded as ±(30000 − 100·n), n = moves to mate.
const isMate = (cp) => cp >= 29000 - 100 * 7;
const mateIn = (cp) => Math.round((30000 - cp) / 100);
const play = (fen, move) => {
  const p = Position.fromFen(fen);
  const m = parseIccs(p, move);
  if (m === null) throw new Error(`illegal ${move} in ${fen}`);
  p.make(m);
  return p.toFen();
};

/** Pieces of the side that just moved that the moved piece now attacks (for the fork theme). */
function attackedBy(fen, square) {
  const p = Position.fromFen(fen);
  const s = "abcdefghi".indexOf(square[0]) + 9 * Number(square[1]);
  const code = p.board[s];
  if (!code) return [];
  return p
    .pieceMoves(s)
    .map((m) => m >> 7)
    .filter((t) => p.board[t] !== 0 && p.board[t] > 0 !== code > 0)
    .map((t) => Math.abs(p.board[t]));
}

// --- Self-play ----------------------------------------------------------------------------
async function selfPlay(engine, r) {
  const records = [];
  let fen = START_FEN;
  const g = new Game();
  for (let ply = 0; ply < 160 && !g.result; ply++) {
    const lines = await engine.analyze(fen, 6, 5);
    if (!lines.length) break;
    let top = lines[0].cp;
    // Hard mode: a big advantage may hide a forced mate the shallow search can't see.
    if (HARD && top >= 600 && top < 29000 - 100 * 7) top = (await engine.analyze(fen, 14, 1))[0]?.cp ?? top;
    records.push({ fen, top });
    let move;
    if (ply >= 6 && r() < 0.03) {
      const legal = g.legalMoves().map(toIccs);
      move = legal[Math.floor(r() * legal.length)];
    } else {
      const best = lines[0].cp;
      const pool = lines.filter((l) => best - l.cp <= 350);
      const w = pool.map((l) => Math.exp((l.cp - best) / 90));
      let x = r() * w.reduce((a, b) => a + b, 0);
      move = pool.find((_, i) => (x -= w[i]) <= 0)?.move ?? pool[0].move;
    }
    if (!g.move(move)) break;
    fen = g.fen;
  }
  // Candidates: a move that turns "about level" into "clearly winning" for the side to move.
  const out = [];
  for (let i = 1; i < records.length; i++) {
    const now = records[i].top; // side to move at i
    const before = -records[i - 1].top; // same side's view one ply earlier
    if (now >= 300 && before <= 100 && i >= 8) out.push(records[i].fen);
    // Hard mode: the moment a forced mate in 2–7 appears (it wasn't there a move earlier).
    else if (HARD && i >= 8 && isMate(now) && mateIn(now) >= 2 && !isMate(before)) out.push(records[i].fen);
  }
  return out;
}

// --- Puzzle extraction --------------------------------------------------------------------
const STATS = { candidates: 0, notUnique: 0, noWin: 0, even: 0, ok: 0 };
let rand = Math.random;
async function buildPuzzle(engine, start) {
  STATS.candidates++;
  const solverRed = sideRed(start);
  const solution = [];
  let fen = start;
  let mate = null;
  for (let k = 0; k < MAX_SOLVER_MOVES; k++) {
    const lines = await engine.analyze(fen, DEPTH, 2);
    const [best, second] = lines;
    if (!best) break;
    // Unique: the only clearly winning move; for a mate, no other move mates as fast (a
    // second mate at least two moves slower is fine).
    const unique =
      !second ||
      (isMate(best.cp) && (!isMate(second.cp) || mateIn(second.cp) >= mateIn(best.cp) + 2)) ||
      (!isMate(best.cp) && best.cp - second.cp >= 250);
    if (!unique || best.cp < 250) {
      if (k === 0) STATS.notUnique++;
      break;
    }
    solution.push(best.move);
    fen = play(fen, best.move);
    if (new Game(fen).result) {
      mate = Math.ceil(solution.length / 2);
      break;
    }
    // Opponent's best reply; continue only if the solver's next move is again unique.
    const reply = (await engine.analyze(fen, DEPTH - 2, 1))[0];
    if (!reply) break;
    const afterReply = play(fen, reply.move);
    const peek = await engine.analyze(afterReply, DEPTH, 2);
    const nextUnique =
      peek[0] &&
      peek[0].cp >= 250 &&
      (!peek[1] ||
        (isMate(peek[0].cp) && (!isMate(peek[1].cp) || mateIn(peek[1].cp) >= mateIn(peek[0].cp) + 2)) ||
        (!isMate(peek[0].cp) && peek[0].cp - peek[1].cp >= 250));
    const gained = material(afterReply, solverRed) - material(start, solverRed);
    const mating = peek[0] !== undefined && isMate(peek[0].cp);
    if (!nextUnique || (gained >= 3 && !mating)) {
      // Stop here, ending on the solver's move — but only if the win is real after the reply.
      if (gained < 2 && !mating) {
        STATS.noWin++;
        return null;
      }
      break;
    }
    solution.push(reply.move);
    fen = afterReply;
  }
  if (solution.length === 0 || solution.length % 2 === 0) {
    if (solution.length) STATS.even++;
    return null;
  }
  STATS.ok++;

  // Difficulty: the shallowest depth from which the engine finds the first move and keeps it.
  let found = 15;
  for (let d = 14; d >= 1; d--) {
    const l = (await engine.analyze(start, d, 1))[0];
    if (l?.move === solution[0]) found = d;
    else break;
  }
  const solverMoves = (solution.length + 1) / 2;
  if (HARD && solverMoves < 2) {
    STATS.oneMoveSkipped = (STATS.oneMoveSkipped ?? 0) + 1;
    return null;
  }
  const firstIsCapture = Position.fromFen(start).board["abcdefghi".indexOf(solution[0][2]) + 9 * Number(solution[0][3])] !== 0;
  const trivial = solverMoves === 1 && found <= 2 && firstIsCapture && !mate;
  // Keep only some of the "grab the hanging piece" puzzles so the set has a spread.
  if (trivial && rand() > 0.3) {
    STATS.trivialSkipped = (STATS.trivialSkipped ?? 0) + 1;
    return null;
  }
  const rating = Math.max(
    400,
    Math.min(2400, Math.round(300 + 90 * found + 230 * (solverMoves - 1) + (firstIsCapture ? 0 : 150) - (mate ? 50 : 0))),
  );

  // Themes.
  const themes = new Set();
  if (mate) themes.add(`mateIn${solverMoves}`);
  else themes.add("advantage");
  themes.add(solverMoves === 1 ? "oneMove" : solverMoves === 2 ? "short" : "long");
  let f = start;
  solution.forEach((m, i) => {
    const mover = Math.abs(Position.fromFen(f).board["abcdefghi".indexOf(m[0]) + 9 * Number(m[1])]);
    const next = play(f, m);
    if (i % 2 === 0) {
      themes.add({ 4: "horse", 5: "chariot", 6: "cannon", 7: "soldier", 1: "general", 2: "advisor", 3: "elephant" }[mover]);
      const hits = attackedBy(next, m.slice(2, 4)).filter((t) => t === 1 || VALUE[t] >= 4);
      if (hits.length >= 2) themes.add("fork");
      if (material(next, solverRed) < material(f, solverRed) - 1) themes.add("sacrifice");
    }
    f = next;
  });
  const id = createHash("sha1").update(start).digest("hex").slice(0, 10);
  return { id, fen: start, solution, rating, themes: [...themes], source: HARD ? "pikafish-selfplay-hard" : "pikafish-selfplay" };
}

// --- Run ---------------------------------------------------------------------------------
async function worker(w, games, seen) {
  const engine = startEngine();
  await engine.init();
  const r = rng(SEED * 1000 + w);
  rand = r;
  let made = 0;
  for (let gi = 0; gi < games; gi++) {
    const cands = await selfPlay(engine, r);
    for (const fen of cands) {
      const key = fen.split(" ").slice(0, 2).join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      const p = await buildPuzzle(engine, fen).catch(() => null);
      if (p) {
        appendFileSync(OUT, JSON.stringify(p) + "\n");
        made++;
      }
    }
    console.log(`worker ${w}: game ${gi + 1}/${games}, ${made} puzzles so far`, JSON.stringify(STATS));
  }
  engine.quit();
  return made;
}

if (!existsSync(ENGINE)) throw new Error(`native Pikafish not found at ${ENGINE}`);
const seen = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).fen.split(" ").slice(0, 2).join(" ")) : []);
if (!existsSync(OUT)) writeFileSync(OUT, "");
const per = Math.ceil(GAMES / WORKERS);
const counts = await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w, per, seen)));
console.log(`done: ${counts.reduce((a, b) => a + b, 0)} new puzzles → ${OUT}`);
