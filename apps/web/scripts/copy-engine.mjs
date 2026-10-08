// Copy the engine's browser files from the npm package into public/engine/fairy/.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(fileURLToPath(new URL("../../../packages/engine/package.json", import.meta.url)));
const from = dirname(require.resolve("fairy-stockfish-nnue.wasm/package.json"));
const to = fileURLToPath(new URL("../public/engine/fairy/", import.meta.url));
mkdirSync(to, { recursive: true });
for (const f of ["stockfish.js", "stockfish.wasm", "stockfish.worker.js", "Copying.txt"]) copyFileSync(join(from, f), join(to, f));
console.log("engine files →", to);

// For hosts without custom headers (GitHub Pages): the COOP/COEP service worker, served from the site root.
const coi = dirname(require.resolve("coi-serviceworker/package.json", { paths: [fileURLToPath(new URL("..", import.meta.url))] }));
// Two fixes to v0.1.7, which rebuilds every response to add the headers:
// - responses from other sites (Supabase) are left to the browser: CORS responses already
//   satisfy COEP, so they need no headers, and rebuilding them is where things break;
// - a response that may not have a body (204 No Content, 304, ...) is rebuilt without one;
//   v0.1.7 passes `body` through, which throws, so the page sees "Failed to fetch".
let sw = readFileSync(join(coi, "coi-serviceworker.min.js"), "utf8");
const patches = [
  ["const r=e.request;", 'const r=e.request;if("cors"===r.mode&&new URL(r.url).origin!==self.location.origin)return;'],
  ["new Response(e.body,", "new Response([101,103,204,205,304].includes(e.status)?null:e.body,"],
];
for (const [from, to] of patches) {
  if (!sw.includes(from)) throw new Error(`coi-serviceworker changed: "${from}" not found; review the patches in copy-engine.mjs`);
  sw = sw.replace(from, to);
}
writeFileSync(fileURLToPath(new URL("../public/coi-serviceworker.js", import.meta.url)), sw);
