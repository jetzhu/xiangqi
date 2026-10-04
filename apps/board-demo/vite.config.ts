import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = (p: string) => fileURLToPath(new URL(`../../packages/${p}`, import.meta.url));

// Use the workspace packages' TypeScript sources directly so edits hot-reload.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@xq/board": src("board/src/index.ts"),
      "xiangqi-core": src("xiangqi-core/src/index.ts"),
    },
  },
  server: { host: "127.0.0.1", port: 5173 },
});
