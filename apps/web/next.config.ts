import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// The build id written by scripts/write-version.mjs, embedded so the site can tell when a
// newer build is live.
let build = "dev";
try {
  build = (JSON.parse(readFileSync(new URL("./public/version.json", import.meta.url), "utf8")) as { build: string }).build;
} catch {
  // no version file (e.g. a bare `next dev`)
}

// The engine runs threads (SharedArrayBuffer), so pages must be cross-origin isolated.
// Production is a static export: these headers are set by the host (public/_headers,
// vercel.json). In development Next serves them itself.
const isolation = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];
const prod = process.env.NODE_ENV === "production";

const config: NextConfig = {
  ...(prod ? { output: "export" as const, trailingSlash: true } : {}),
  // A project site on GitHub Pages lives under /<repo>; see lib/site.ts.
  ...(process.env.NEXT_PUBLIC_BASE_PATH ? { basePath: process.env.NEXT_PUBLIC_BASE_PATH } : {}),
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BUILD: build },
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@xq/ui", "@xq/board", "@xq/engine", "@xq/bots", "@xq/lessons", "@xq/puzzles", "@xq/content", "@xq/records", "xiangqi-core"],
  // Sources import siblings as "./x.js" (NodeNext style); map that to the .ts/.tsx file.
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    return cfg;
  },
  ...(prod ? {} : { headers: async () => [{ source: "/:path*", headers: isolation }] }),
};

export default config;
