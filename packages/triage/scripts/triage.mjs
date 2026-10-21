// Runs one triage pass (src/cli.ts; daily.mjs is the scheduled wrapper): bundles the TypeScript sources, then runs them. The project
// comes from apps/web/.env (or SUPABASE_PROJECT_REF), as for the deploy scripts.
//
//   SUPABASE_ACCESS_TOKEN=$(cat ~/.config/xiangqi-supabase-token) node packages/triage/scripts/triage.mjs [--dry-run] [--limit N]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rolldown } from "rolldown";

const here = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const env = readFileSync(new URL("../../../apps/web/.env", import.meta.url), "utf8");
const ref = process.env.SUPABASE_PROJECT_REF ?? new URL(env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)[1].trim()).hostname.split(".")[0];

const build = await rolldown({ input: here("src/cli.ts"), platform: "node", resolve: { extensionAlias: { ".js": [".ts", ".js"] } }, logLevel: "warn" });
const { output } = await build.generate({ format: "esm" });
await build.close();
mkdirSync(here("dist"), { recursive: true });
writeFileSync(here("dist/cli.mjs"), output[0].code);
const { main } = await import(pathToFileURL(here("dist/cli.mjs")).href);
try {
  await main(process.argv.slice(2), process.env, ref);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
