// Write public/version.json with this build's identifier (short commit + UTC time). The site
// embeds the same value (NEXT_PUBLIC_BUILD, read in next.config.ts) and polls the file to offer
// a reload when a newer build has been deployed.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let commit = "local";
try {
  commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch {
  // not a git checkout
}
const build = `${commit}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
const dir = fileURLToPath(new URL("../public/", import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}version.json`, JSON.stringify({ build }));
console.log("build", build);
