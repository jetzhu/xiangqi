// Merge puzzle files into content/puzzles/puzzles.jsonl, dropping duplicates: the same
// position, or its left-right mirror image (Xiangqi is symmetric across the centre file).
// Earlier files win. Usage: node scripts/merge.mjs out.jsonl in1.jsonl in2.jsonl…
import { readFileSync, writeFileSync } from "node:fs";

const [out, ...inputs] = process.argv.slice(2);
const mirrorBoard = (board) =>
  board
    .split("/")
    .map((rank) => rank.replace(/\d/g, (d) => "1".repeat(Number(d))).split("").reverse().join("").replace(/1+/g, (m) => String(m.length)))
    .join("/");
const key = (fen) => fen.split(" ").slice(0, 2).join(" ");
const seen = new Set();
const kept = [];
let dupes = 0;
for (const file of inputs) {
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const p = JSON.parse(line);
    const [board, side] = p.fen.split(" ");
    const k = key(p.fen);
    const m = `${mirrorBoard(board)} ${side}`;
    if (seen.has(k) || seen.has(m)) {
      dupes++;
      continue;
    }
    seen.add(k);
    kept.push(p);
  }
}
writeFileSync(out, kept.map((p) => JSON.stringify(p)).join("\n") + "\n");
console.log(`${kept.length} puzzles → ${out} (${dupes} duplicates dropped)`);
