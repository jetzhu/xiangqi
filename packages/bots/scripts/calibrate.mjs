// Bot rating calibration: the bots play each other with the site's own engine build and
// move choice, and their ratings are fitted from the results.
//
//   node scripts/calibrate.mjs run [--games=40] [--jobs=3]   play (resumes where it stopped)
//   node scripts/calibrate.mjs report                         fit ratings, write calibration/report.md
//   node scripts/calibrate.mjs game <red id> <black id>        play one game and print it (not saved)
//
// Each neighbouring pair of bots on the ladder plays --games games and each pair two steps
// apart half as many, colours alternating. Results are appended to calibration/games.jsonl,
// each with both bots' settings: after a bot's settings change, only its games are replayed.
import { fork } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rolldown } from "rolldown";

const here = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const root = (p) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const pkg = (name) => root(`packages/${name}/src/index.ts`);
const BOTS = JSON.parse(readFileSync(root("content/bots/bots.json"), "utf8"));
const GAMES_FILE = here("calibration/games.jsonl");
const arg = (name, def) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? def);

async function bundle() {
  const build = await rolldown({
    input: here("scripts/match.ts"),
    platform: "node",
    resolve: {
      alias: { "xiangqi-core": pkg("xiangqi-core"), "@xq/engine": pkg("engine") },
      extensionAlias: { ".js": [".ts", ".js"] },
    },
    logLevel: "warn",
  });
  mkdirSync(here("dist/calibrate"), { recursive: true });
  await build.write({ file: here("dist/calibrate/match.mjs"), format: "esm" });
  await build.close();
  // The site's engine files, in a folder Node reads as CommonJS (the web app's is an ES module package).
  mkdirSync(here("dist/calibrate/fairy"), { recursive: true });
  writeFileSync(here("dist/calibrate/fairy/package.json"), '{ "type": "commonjs" }\n');
  for (const f of ["stockfish.js", "stockfish.wasm", "stockfish.worker.js"]) copyFileSync(root(`apps/web/public/engine/fairy/${f}`), here(`dist/calibrate/fairy/${f}`));
}

/** The site's Fairy-Stockfish build, set up as the bots use it (one thread, 16 MB hash). */
async function loadEngine(XiangqiEngine) {
  const require = createRequire(import.meta.url);
  const dir = here("dist/calibrate/fairy");
  const factory = require(`${dir}/stockfish.js`);
  const sf = await factory({ wasmBinary: readFileSync(`${dir}/stockfish.wasm`) });
  const transport = { send: (c) => sf.postMessage(c), onLine: (cb) => sf.addMessageListener(cb), terminate: () => sf.terminate() };
  const setup = ["setoption name UCI_Variant value xiangqi", "setoption name Threads value 1", "setoption name Hash value 16"];
  return XiangqiEngine.create(transport, { coords: "fairy", setup });
}

/** A bot's playing settings; games played with older settings are left out. */
const settingsOf = (id) => JSON.stringify(BOTS.find((b) => b.id === id)?.strength ?? null);
const current = (g) => g.settings?.red === settingsOf(g.red) && g.settings?.black === settingsOf(g.black);
const results = () =>
  (existsSync(GAMES_FILE) ? readFileSync(GAMES_FILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []).filter(current);

/** Games still to play: [redId, blackId] per game. */
function schedule(games) {
  const done = new Map();
  for (const r of results()) done.set(`${r.red}/${r.black}`, (done.get(`${r.red}/${r.black}`) ?? 0) + 1);
  const jobs = [];
  for (let i = 0; i < BOTS.length; i++) {
    for (const [step, n] of [[1, games], [2, games / 2]]) {
      const j = i + step;
      if (j >= BOTS.length) continue;
      const [a, b] = [BOTS[i].id, BOTS[j].id];
      // Half the games each way round.
      for (const [red, black] of [[a, b], [b, a]]) {
        const left = Math.ceil(n / 2) - (done.get(`${red}/${black}`) ?? 0);
        for (let k = 0; k < left; k++) jobs.push([red, black]);
      }
    }
  }
  // Slow games (the strongest bots) first, so the run ends with quick ones.
  const idx = (id) => BOTS.findIndex((b) => b.id === id);
  return jobs.sort((x, y) => Math.max(idx(y[0]), idx(y[1])) - Math.max(idx(x[0]), idx(x[1])));
}

async function run() {
  await bundle();
  mkdirSync(here("calibration"), { recursive: true });
  const jobs = schedule(arg("games", 40));
  const workers = Math.min(arg("jobs", 3), jobs.length);
  console.log(`${jobs.length} games to play on ${workers} workers`);
  let next = 0;
  let finished = 0;
  await Promise.all(
    Array.from({ length: workers }, () => {
      const child = fork(fileURLToPath(import.meta.url), ["worker"]);
      return new Promise((resolve) => {
        const give = () => (next < jobs.length ? child.send(jobs[next++]) : child.send("done"));
        child.on("message", (m) => {
          if (m !== "ready") {
            appendFileSync(GAMES_FILE, `${JSON.stringify(m)}\n`);
            finished++;
            const s = m.score === 1 ? "1-0" : m.score === 0 ? "0-1" : "½-½";
            console.log(`${finished}/${jobs.length}  ${m.red} ${s} ${m.black}  ${m.reason}, ${m.plies} plies`);
          }
          give();
        });
        child.on("exit", resolve);
      });
    }),
  );
}

async function worker() {
  const { playGame, XiangqiEngine } = await import(pathToFileURL(here("dist/calibrate/match.mjs")).href);
  const engines = { red: await loadEngine(XiangqiEngine), black: await loadEngine(XiangqiEngine) };
  const bot = (id) => BOTS.find((b) => b.id === id);
  process.on("message", async (m) => {
    if (m === "done") {
      engines.red.quit();
      engines.black.quit();
      process.exit(0);
    }
    const settings = { red: settingsOf(m[0]), black: settingsOf(m[1]) };
    process.send({ ...(await playGame(bot(m[0]), bot(m[1]), engines)), settings });
  });
  process.send("ready");
}

/** Maximum-likelihood ratings (Elo scale, draws as half a point), mean fixed at `mean`. */
function fit(games, ids, mean) {
  const r = Object.fromEntries(ids.map((id) => [id, 0]));
  for (let it = 0; it < 5000; it++) {
    const grad = Object.fromEntries(ids.map((id) => [id, 0]));
    for (const g of games) {
      const p = 1 / (1 + 10 ** ((r[g.black] - r[g.red]) / 400));
      grad[g.red] += g.score - p;
      grad[g.black] -= g.score - p;
    }
    let moved = 0;
    for (const id of ids) {
      const step = 8 * grad[id];
      r[id] += step;
      moved = Math.max(moved, Math.abs(step));
    }
    if (moved < 1e-4) break;
  }
  const shift = mean - ids.reduce((a, id) => a + r[id], 0) / ids.length;
  return Object.fromEntries(ids.map((id) => [id, r[id] + shift]));
}

function report() {
  const games = results();
  const ids = BOTS.map((b) => b.id).filter((id) => games.some((g) => g.red === id || g.black === id));
  const mean = ids.reduce((a, id) => a + BOTS.find((b) => b.id === id).ratingLabel, 0) / ids.length;
  const best = fit(games, ids, mean);
  // 95 % intervals from 200 bootstrap resamples of the games.
  let seed = 1;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const samples = Array.from({ length: 200 }, () => fit(Array.from(games, () => games[Math.floor(rand() * games.length)]), ids, mean));
  const ci = (id) => {
    const v = samples.map((s) => s[id]).sort((a, b) => a - b);
    return [v[5], v[194]];
  };
  const pairs = new Map();
  for (const g of games) {
    const [a, b] = [g.red, g.black].sort((x, y) => ids.indexOf(x) - ids.indexOf(y));
    const k = `${a} vs ${b}`;
    const p = pairs.get(k) ?? { n: 0, a: 0, draws: 0 };
    p.n++;
    p.a += g.red === a ? g.score : 1 - g.score;
    if (g.score === 0.5) p.draws++;
    pairs.set(k, p);
  }
  const ms = (id) => {
    const v = games.flatMap((g) => (g.msPerMove[id] !== undefined ? [g.msPerMove[id]] : []));
    return Math.round(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length));
  };
  const lines = [
    "# Bot calibration",
    "",
    `${games.length} bot-vs-bot games with the site's Fairy-Stockfish build and move choice (\`scripts/calibrate.mjs\`). Ratings are fitted on the Elo scale, draws as half a point, with the average fixed at the average of the current labels (${Math.round(mean)}); only the gaps are measured.`,
    "",
    "| Bot | Label | Fitted | 95 % range | Engine time per move |",
    "| --- | --- | --- | --- | --- |",
    ...ids.map((id) => {
      const b = BOTS.find((x) => x.id === id);
      const [lo, hi] = ci(id);
      return `| ${b.name.en} | ${b.ratingLabel} | ${Math.round(best[id])} | ${Math.round(lo)}–${Math.round(hi)} | ${ms(id)} ms |`;
    }),
    "",
    "| Pairing | Games | Score of the first | Draws |",
    "| --- | --- | --- | --- |",
    ...[...pairs].map(([k, p]) => `| ${k} | ${p.n} | ${(100 * p.a / p.n).toFixed(0)} % | ${p.draws} |`),
    "",
  ];
  writeFileSync(here("calibration/report.md"), lines.join("\n"));
  console.log(lines.join("\n"));
}

async function one(redId, blackId) {
  await bundle();
  const { playGame, XiangqiEngine } = await import(pathToFileURL(here("dist/calibrate/match.mjs")).href);
  const engines = { red: await loadEngine(XiangqiEngine), black: await loadEngine(XiangqiEngine) };
  const bot = (id) => BOTS.find((b) => b.id === id) ?? (() => { throw new Error(`unknown bot ${id}`); })();
  const t0 = Date.now();
  const g = await playGame(bot(redId), bot(blackId), engines);
  console.log(`${g.red} ${g.score === 1 ? "1-0" : g.score === 0 ? "0-1" : "½-½"} ${g.black}: ${g.reason}, ${g.plies} plies, ${((Date.now() - t0) / 1000).toFixed(0)} s, engine ms/move ${JSON.stringify(g.msPerMove)}`);
  console.log(g.moves.join(" "));
  process.exit(0);
}

const mode = process.argv[2];
if (mode === "worker") await worker();
else if (mode === "game") await one(process.argv[3], process.argv[4]);
else if (mode === "report") report();
else if (mode === "run") await run();
else console.error("usage: node scripts/calibrate.mjs run [--games=40] [--jobs=3] | report | game <red> <black>");
