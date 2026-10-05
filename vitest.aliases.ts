// Resolve workspace packages to their TypeScript sources in tests, so tests never run
// against a stale or missing dist/ build.
import { fileURLToPath } from "node:url";

const src = (p: string) => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));

export const workspaceAliases = {
  "xiangqi-core": src("xiangqi-core"),
  "@xq/board": src("board"),
  "@xq/engine": src("engine"),
  "@xq/bots": src("bots"),
  "@xq/lessons": src("lessons"),
};
