// Performance budget for the static export (run after `pnpm build`).
// Initial JS: scripts each page's HTML loads up front (minus nomodule polyfills, which
// modern browsers skip). Chunk: any single JS file, including the lazily loaded app.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET = { initialKB: 150, chunkKB: 100 };
const out = fileURLToPath(new URL("../out/", import.meta.url));
const gz = (file) => gzipSync(readFileSync(file)).length / 1024;

const pages = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name === "index.html") pages.push(p);
  }
};
walk(out);

let failed = false;
let worst = { page: "", kb: 0 };
for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const scripts = [...html.matchAll(/<script src="([^"]+\.js)"([^>]*)>/g)].filter((m) => !m[2].includes("noModule") && !m[2].includes("nomodule"));
  const kb = scripts.reduce((sum, m) => sum + gz(join(out, decodeURIComponent(m[1]))), 0);
  if (kb > worst.kb) worst = { page: page.slice(out.length), kb };
  if (kb > BUDGET.initialKB) {
    console.error(`✗ ${page.slice(out.length)}: initial JS ${kb.toFixed(0)} KB gz > ${BUDGET.initialKB}`);
    failed = true;
  }
}
console.log(`initial JS (worst page ${worst.page}): ${worst.kb.toFixed(0)} KB gz, budget ${BUDGET.initialKB}`);

const chunks = join(out, "_next/static/chunks");
const files = [];
const walkJs = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkJs(p);
    else if (name.endsWith(".js") && !name.startsWith("polyfills")) files.push(p);
  }
};
walkJs(chunks);
const biggest = files.map((f) => ({ f: f.slice(out.length), kb: gz(f) })).sort((a, b) => b.kb - a.kb)[0];
console.log(`largest chunk ${biggest.f}: ${biggest.kb.toFixed(0)} KB gz, budget ${BUDGET.chunkKB}`);
if (biggest.kb > BUDGET.chunkKB) failed = true;

const wasm = join(out, "engine/fairy/stockfish.wasm");
console.log(`engine (loaded on analysis/bots only): ${(gz(wasm) / 1024).toFixed(2)} MB gz`);
process.exit(failed ? 1 : 0);
