import type { NextConfig } from "next";

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
  images: { unoptimized: true },
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@xq/ui", "@xq/board", "@xq/engine", "@xq/bots", "@xq/lessons", "@xq/puzzles", "@xq/content", "xiangqi-core"],
  // Sources import siblings as "./x.js" (NodeNext style); map that to the .ts/.tsx file.
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    return cfg;
  },
  ...(prod ? {} : { headers: async () => [{ source: "/:path*", headers: isolation }] }),
};

export default config;
