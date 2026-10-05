// Copy the engine's browser files from the npm package into public/engine/fairy/.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(fileURLToPath(new URL("../../../packages/engine/package.json", import.meta.url)));
const from = dirname(require.resolve("fairy-stockfish-nnue.wasm/package.json"));
const to = fileURLToPath(new URL("../public/engine/fairy/", import.meta.url));
mkdirSync(to, { recursive: true });
for (const f of ["stockfish.js", "stockfish.wasm", "stockfish.worker.js", "Copying.txt"]) copyFileSync(join(from, f), join(to, f));
console.log("engine files →", to);
