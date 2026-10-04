// M0 engine spike: compare Xiangqi engines compiled to WASM.
// Measures package size, load time and search speed/depth at fixed think times.
// Usage: node bench.mjs [fairy|pikafish|all] [--threads=1,4] [--times=1000,5000]

import { createRequire } from "node:module";
import { readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith("--")) ?? "all";
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1].split(",").map(Number) : def;
};
const THREADS = opt("threads", [1, 4]);
const TIMES = opt("times", [1000, 5000]);

// Benchmark positions in standard Xiangqi FEN (both engines accept it).
const POSITIONS = {
  start: "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
  // 1. C2=5 H8+7 2. H2+3 R9=8 (central cannon vs screen horse start)
  opening: "rnbakabr1/9/1c4nc1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C1N2/9/RNBAKAB1R w - - 4 3",
};

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// A tiny UCI driver over any engine that exposes send(line) and onLine(cb).
function uci(engine) {
  let waiters = [];
  engine.onLine((line) => {
    for (const w of [...waiters]) {
      if (w.test(line)) {
        waiters = waiters.filter((x) => x !== w);
        w.resolve(line);
      } else w.collect?.(line);
    }
  });
  const until = (test, collect) =>
    new Promise((resolve) => waiters.push({ test, resolve, collect }));
  return {
    send: (l) => engine.send(l),
    async ready() {
      const p = until((l) => l === "readyok");
      engine.send("isready");
      await p;
    },
    async search(fen, movetime) {
      let last = null;
      const p = until(
        (l) => l.startsWith("bestmove"),
        (l) => {
          if (l.startsWith("info") && l.includes(" nodes ")) last = l;
        },
      );
      engine.send(`position fen ${fen}`);
      engine.send(`go movetime ${movetime}`);
      const best = await p;
      const field = (k) => last?.match(new RegExp(` ${k} (\\S+)`))?.[1];
      return {
        depth: Number(field("depth")),
        seldepth: Number(field("seldepth")),
        nodes: Number(field("nodes")),
        nps: Number(field("nps")),
        score: last?.match(/ score (cp|mate) (-?\d+)/)?.slice(1).join(" "),
        best: best.split(" ")[1],
      };
    },
  };
}

// --- Adapters -------------------------------------------------------------

const FAIRY_NET = join(here, "vendor", "fairy", "xiangqi-c07e94a5c7cb.nnue");

async function loadFairy({ nnue = false } = {}) {
  const dir = dirname(require.resolve("fairy-stockfish-nnue.wasm/package.json"));
  const wasmPath = join(dir, "stockfish.wasm");
  const Stockfish = require(join(dir, "stockfish.js"));
  const t0 = performance.now();
  // Passing the bytes avoids the old glue calling fetch() on a file path.
  const sf = await Stockfish({ wasmBinary: readFileSync(wasmPath) });
  let net = null;
  if (nnue) {
    if (!existsSync(FAIRY_NET)) throw new Error(`net missing: ${FAIRY_NET}`);
    net = readFileSync(FAIRY_NET);
    sf.FS.writeFile("/xiangqi.nnue", net);
  }
  const loadMs = performance.now() - t0;
  const listeners = [];
  sf.addMessageListener((l) => listeners.forEach((cb) => cb(l)));
  const engine = {
    send: (l) => sf.postMessage(l),
    onLine: (cb) => listeners.push(cb),
    quit: () => sf.terminate(),
  };
  return {
    name: `Fairy-Stockfish (npm fairy-stockfish-nnue.wasm 1.1.12, ${nnue ? "NNUE xiangqi-c07e94a5c7cb" : "classical eval"})`,
    engine,
    // Must follow "uci"; sent earlier it is silently ignored and the engine plays chess.
    setup: [
      "setoption name UCI_Variant value xiangqi",
      ...(nnue ? ["setoption name EvalFile value /xiangqi.nnue", "setoption name Use NNUE value true"] : []),
    ],
    loadMs,
    download: { js: statSync(join(dir, "stockfish.js")).size, wasm: statSync(wasmPath).size, net: net?.length ?? 0 },
  };
}

// The upstream wasm32 build reads UCI from stdin on its main thread, which blocks output
// while a search runs. Interactive use needs an exported command entry point (browser build);
// for Node numbers we use the engine's synchronous `bench` command, one process per setting.
async function benchPikafish() {
  const dir = join(here, "vendor", "pikafish");
  const files = ["pikafish.js", "pikafish.wasm", "pikafish.nnue"].map((f) => join(dir, f));
  if (!files.every(existsSync)) throw new Error(`Pikafish build missing in ${dir}; run ./build-pikafish.sh`);
  const { spawn } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(dir, "positions.fen"), Object.values(POSITIONS).join("\n") + "\n");

  const run = (input, args = []) =>
    new Promise((resolve) => {
      const t0 = performance.now();
      const p = spawn(process.execPath, [files[0], ...args], { cwd: dir });
      let out = "";
      let readyMs = null;
      p.stderr.on("data", (d) => (out += d)); // bench prints "Position:" lines to stderr
      p.stdout.on("data", (d) => {
        out += d;
        if (readyMs === null && out.includes("readyok")) {
          readyMs = performance.now() - t0;
          p.stdin.write("quit\n");
        }
      });
      p.on("close", () => resolve({ out, readyMs }));
      if (input) p.stdin.write(input);
      else p.stdin.end();
    });

  const { readyMs } = await run("uci\nisready\n");
  const d = { js: statSync(files[0]).size, wasm: statSync(files[1]).size, net: statSync(files[2]).size };
  console.log(`\n## Pikafish (official source ${PIKAFISH_COMMIT}, built here with Emscripten 3.1.74)`);
  console.log(
    `download: js ${kb(d.js)}, wasm ${kb(d.wasm)}, net ${mb(d.net)} (total ${mb(d.js + d.wasm + d.net)}); ` +
      `load ${readyMs.toFixed(0)} ms (process start to readyok, includes Node startup and net load)`,
  );
  console.log("| threads | position | movetime | depth | nodes | nps | score | best |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
  const names = Object.keys(POSITIONS);
  for (const t of THREADS) {
    for (const ms of TIMES) {
      const { out } = await run(null, ["bench", "64", String(t), String(ms), "positions.fen", "movetime"]);
      // Split output per position; take the last full info line before each bestmove.
      const chunks = out.split(/^Position: /m).slice(1);
      chunks.forEach((chunk, i) => {
        const infos = chunk.split("\n").filter((l) => l.startsWith("info depth") && l.includes(" nodes "));
        const last = infos.at(-1) ?? "";
        const field = (k) => last.match(new RegExp(` ${k} (\\S+)`))?.[1];
        const best = chunk.match(/^bestmove (\S+)/m)?.[1];
        console.log(
          `| ${t} | ${names[i]} | ${ms} ms | ${field("depth")}/${field("seldepth")} | ` +
            `${Number(field("nodes")).toLocaleString("en")} | ${Number(field("nps")).toLocaleString("en")} | ` +
            `${last.match(/ score (cp|mate) (-?\d+)/)?.slice(1).join(" ")} | ${best} |`,
        );
      });
    }
  }
}

const PIKAFISH_COMMIT = "1c66b9b2";

// --- Run ------------------------------------------------------------------

async function bench(loader) {
  const e = await loader();
  const u = uci(e.engine);
  u.send("uci");
  for (const line of e.setup ?? []) u.send(line);
  await u.ready();
  const d = e.download;
  console.log(`\n## ${e.name}`);
  console.log(
    `download: js ${kb(d.js)}, wasm ${kb(d.wasm)}, net ${d.net ? mb(d.net) : "none"} ` +
      `(total ${mb(d.js + d.wasm + d.net)}); load ${e.loadMs.toFixed(0)} ms${e.loadNote ? ` (${e.loadNote})` : ""}`,
  );
  console.log("| threads | position | movetime | depth | nodes | nps | score | best |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const t of THREADS) {
    u.send(`setoption name Threads value ${t}`);
    u.send("setoption name Hash value 64");
    await u.ready();
    for (const [pname, fen] of Object.entries(POSITIONS)) {
      for (const ms of TIMES) {
        u.send("ucinewgame");
        await u.ready();
        const r = await u.search(fen, ms);
        console.log(
          `| ${t} | ${pname} | ${ms} ms | ${r.depth}/${r.seldepth} | ${r.nodes.toLocaleString("en")} | ` +
            `${r.nps.toLocaleString("en")} | ${r.score} | ${r.best} |`,
        );
      }
    }
  }
  e.engine.quit();
}

const runs = {
  fairy: () => bench(() => loadFairy()),
  "fairy-nnue": () => bench(() => loadFairy({ nnue: true })),
  pikafish: benchPikafish,
};
console.log(`# Engine spike — ${new Date().toISOString().slice(0, 10)}, Node ${process.version}, ${os.cpus()[0].model} (${os.cpus().length} threads)`);
for (const [name, runFn] of Object.entries(runs)) {
  if (which !== "all" && which !== name) continue;
  try {
    await runFn();
  } catch (err) {
    console.log(`\n## ${name}: FAILED — ${err.message}`);
  }
}
process.exit(0);
