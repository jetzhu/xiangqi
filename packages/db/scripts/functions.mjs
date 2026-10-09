// Bundles the server functions (supabase/functions/<name>/index.ts, with the workspace code they
// use) into one script each, then deploys them through the Management API, as apply.mjs does
// for migrations. Needs only a personal access token:
//
//   SUPABASE_ACCESS_TOKEN=$(cat ~/.config/xiangqi-supabase-token) node scripts/functions.mjs [--dry-run]
//
// --dry-run only bundles (into dist/functions/) and prints the sizes.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

const here = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const pkg = (name) => fileURLToPath(new URL(`../../${name}/src/index.ts`, import.meta.url));
const env = readFileSync(new URL("../../../apps/web/.env", import.meta.url), "utf8");
const projectUrl = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1]?.trim();
const ref = process.env.SUPABASE_PROJECT_REF ?? new URL(projectUrl).hostname.split(".")[0];
const dryRun = process.argv.includes("--dry-run");

/** Settings per function. verify_jwt is off: the function asks Supabase Auth itself. */
const FUNCTIONS = { record: { verify_jwt: false } };

export async function bundle(name) {
  const build = await rolldown({
    input: here(`supabase/functions/${name}/index.ts`),
    platform: "neutral",
    resolve: {
      alias: {
        "xiangqi-core": pkg("xiangqi-core"),
        "@xq/puzzles": pkg("puzzles"),
        "@xq/content": pkg("content"),
        "@xq/bots": pkg("bots"),
        "@xq/lessons": pkg("lessons"),
        "@xq/records": pkg("records"),
      },
      // Sources import siblings as "./x.js" (NodeNext style).
      extensionAlias: { ".js": [".ts", ".js"] },
    },
    logLevel: "warn",
  });
  const { output } = await build.generate({ format: "esm", codeSplitting: false });
  await build.close();
  return output[0].code;
}

const main = process.argv[1] === fileURLToPath(import.meta.url);
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (main && !dryRun && !token) {
  console.error("Set SUPABASE_ACCESS_TOKEN (a personal access token from supabase.com/dashboard/account/tokens).");
  process.exit(1);
}

for (const name of main ? readdirSync(here("supabase/functions")) : []) {
  const settings = FUNCTIONS[name];
  if (!settings) throw new Error(`no settings for function "${name}" in scripts/functions.mjs`);
  const code = await bundle(name);
  mkdirSync(here("dist/functions"), { recursive: true });
  writeFileSync(here(`dist/functions/${name}.js`), code);
  console.log(`${name}: ${(code.length / 1024).toFixed(0)} KB bundled`);
  if (dryRun) continue;

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({ name, entrypoint_path: "index.js", verify_jwt: settings.verify_jwt })], { type: "application/json" }));
  form.append("file", new Blob([code], { type: "application/javascript" }), "index.js");
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`deploy ${name}: ${res.status} ${text}`);
  const out = JSON.parse(text);
  console.log(`${name}: deployed, version ${out.version}, ${out.status}`);
}
