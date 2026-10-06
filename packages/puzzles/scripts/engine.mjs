// A small UCI client for a native Pikafish, shared by the offline puzzle scripts.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ENGINE = process.env.PIKAFISH ?? join(here, "../../../spikes/engine/vendor/pikafish-native/pikafish");

/** Mate scores are encoded as ±(30000 − 100·n), n = moves to mate. */
export const isMate = (cp) => cp >= 29000 - 100 * 10;
export const mateIn = (cp) => Math.round((30000 - cp) / 100);

export async function startEngine({ threads = 1, hash = 64 } = {}) {
  const p = spawn(ENGINE, [], { cwd: dirname(ENGINE) });
  let buf = "";
  let waiter = null;
  let lines = [];
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const l = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      lines.push(l);
      if (waiter && waiter.test(l)) {
        const w = waiter;
        waiter = null;
        w.resolve(lines.splice(0));
      }
    }
  });
  const send = (c) => p.stdin.write(c + "\n");
  const until = (test) => new Promise((resolve) => (waiter = { test, resolve }));
  send("uci");
  await until((l) => l === "uciok");
  send(`setoption name Threads value ${threads}`);
  send(`setoption name Hash value ${hash}`);
  send("isready");
  await until((l) => l === "readyok");
  return {
    /**
     * Lines sorted by MultiPV: { move, cp } with cp from the side to move. `searchmoves`
     * restricts the search to those moves.
     */
    async analyze(fen, depth, multipv = 1, searchmoves = []) {
      send(`setoption name MultiPV value ${multipv}`);
      send(`position fen ${fen}`);
      send(`go depth ${depth}${searchmoves.length ? ` searchmoves ${searchmoves.join(" ")}` : ""}`);
      const out = await until((l) => l.startsWith("bestmove"));
      const byPv = new Map();
      for (const l of out) {
        if (!l.startsWith("info") || !l.includes(" pv ") || / (lower|upper)bound/.test(l)) continue;
        const d = Number(/ depth (\d+)/.exec(l)?.[1]);
        const k = Number(/ multipv (\d+)/.exec(l)?.[1] ?? 1);
        const mate = / score mate (-?\d+)/.exec(l);
        const cp = mate ? Math.sign(Number(mate[1])) * (30000 - 100 * Math.abs(Number(mate[1]))) : Number(/ score cp (-?\d+)/.exec(l)?.[1]);
        const move = / pv (\S+)/.exec(l)[1];
        const prev = byPv.get(k);
        if (!prev || d >= prev.depth) byPv.set(k, { depth: d, cp, move });
      }
      return [...byPv.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    },
    quit: () => send("quit"),
  };
}
