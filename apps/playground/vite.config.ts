import { copyFileSync, createReadStream, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

const src = (p: string) => fileURLToPath(new URL(`../../packages/${p}`, import.meta.url));

// The engine's files come straight from the npm package; serve them at /engine/fairy/
// in development and copy them into the build output.
const require = createRequire(import.meta.url);
const fairyDir = dirname(require.resolve("fairy-stockfish-nnue.wasm/package.json", { paths: [src("engine")] }));
const FAIRY_FILES = ["stockfish.js", "stockfish.wasm", "stockfish.worker.js"];
const TYPES: Record<string, string> = { js: "text/javascript", wasm: "application/wasm" };

function engineFiles(): Plugin {
  return {
    name: "xq-engine-files",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/engine\/fairy\/([\w.]+)$/.exec(req.url?.split("?")[0] ?? "");
        if (!m || !FAIRY_FILES.includes(m[1]!)) return next();
        res.setHeader("Content-Type", TYPES[m[1]!.split(".").pop()!] ?? "application/octet-stream");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        // Worker scripts need their own isolation headers, or the engine's threads can't start.
        for (const [k, v] of Object.entries(isolation)) res.setHeader(k, v);
        createReadStream(join(fairyDir, m[1]!)).pipe(res);
      });
    },
    writeBundle(options) {
      const out = join(options.dir ?? "dist", "engine", "fairy");
      mkdirSync(out, { recursive: true });
      for (const f of FAIRY_FILES) if (existsSync(join(fairyDir, f))) copyFileSync(join(fairyDir, f), join(out, f));
    },
  };
}

// Cross-origin isolation: the engine uses threads (SharedArrayBuffer).
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react(), engineFiles()],
  resolve: {
    alias: {
      "@xq/board": src("board/src/index.ts"),
      "@xq/engine": src("engine/src/index.ts"),
      "@xq/bots": src("bots/src/index.ts"),
      "@xq/lessons": src("lessons/src/index.ts"),
      "@xq/puzzles": src("puzzles/src/index.ts"),
      "@xq/content": src("content/src/index.ts"),
      "@xq/ui/styles.css": src("ui/src/styles.css"),
      "@xq/ui": src("ui/src/index.ts"),
      "xiangqi-core": src("xiangqi-core/src/index.ts"),
    },
  },
  server: { host: "127.0.0.1", port: 5173, headers: isolation },
  preview: { host: "127.0.0.1", port: 4173, headers: isolation },
});
