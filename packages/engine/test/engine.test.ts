// Integration tests against the real Fairy-Stockfish WASM build, run in Node.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Game, START_FEN, toIccs } from "xiangqi-core";
import { type Transport, XiangqiEngine } from "../src/engine.js";

const require = createRequire(import.meta.url);
let engine: XiangqiEngine;
let terminate: (() => void) | undefined;

beforeAll(async () => {
  const dir = dirname(require.resolve("fairy-stockfish-nnue.wasm/package.json"));
  const factory = require(join(dir, "stockfish.js"));
  const sf = await factory({ wasmBinary: readFileSync(join(dir, "stockfish.wasm")) });
  const transport: Transport = {
    send: (c) => sf.postMessage(c),
    onLine: (cb) => sf.addMessageListener(cb),
    terminate: () => sf.terminate(),
  };
  terminate = () => sf.terminate();
  engine = await XiangqiEngine.create(transport, {
    coords: "fairy",
    setup: ["setoption name UCI_Variant value xiangqi", "setoption name Threads value 2"],
  });
});
// Don't send "quit": in Node the Emscripten build then calls process.exit.
afterAll(() => terminate?.());

describe("XiangqiEngine with Fairy-Stockfish", () => {
  it("returns a legal best move in ICCS and MultiPV lines", async () => {
    const updates: number[] = [];
    const r = await engine.analyze(START_FEN, { depth: 8, multipv: 3 }, (p) => updates.push(p.depth));
    const legal = new Game().legalMoves().map(toIccs);
    expect(legal).toContain(r.bestmove);
    expect(r.lines).toHaveLength(3);
    for (const l of r.lines) expect(legal).toContain(l.pv[0]);
    expect(updates.length).toBeGreaterThan(0);
  });

  it("reports scores from Red's point of view", async () => {
    // Red is a chariot up: positive for Red whichever side is to move.
    const redUp = "4k4/9/9/9/9/9/9/9/9/R2K5";
    const w = await engine.analyze(`${redUp} w - - 0 1`, { depth: 6 });
    const b = await engine.analyze(`${redUp} b - - 0 1`, { depth: 6 });
    expect(w.lines[0]!.score.cp ?? 9999).toBeGreaterThan(300);
    expect(b.lines[0]!.score.cp ?? 9999).toBeGreaterThan(300);
  });

  it("finds a mate in one", async () => {
    // Chariot a8→a9 mates (horse g7 covers e8, chariot f1 covers f9).
    // a8a9 and f1e1 both mate (after f1e1, d9 is ruled out by the flying general).
    const fen = "4k4/R8/6N2/9/9/9/9/9/5R3/3K5 w - - 0 1";
    const r = await engine.analyze(fen, { depth: 6 });
    expect(r.lines[0]!.score.mate).toBe(1);
    const g = new Game(fen);
    g.move(r.bestmove!);
    expect(g.result?.reason).toBe("checkmate");
  });

  it("a new request stops the running infinite search", async () => {
    const first = engine.analyze(START_FEN, { infinite: true });
    await new Promise((res) => setTimeout(res, 300));
    const second = engine.analyze(START_FEN, { depth: 4 });
    const [a, b] = await Promise.all([first, second]);
    expect(a.bestmove).toBeTruthy();
    expect(b.lines[0]!.depth).toBe(4);
    expect(engine.busy).toBe(false);
  });

  it("returns no move when the side to move is mated", async () => {
    const r = await engine.analyze("R3k4/9/6N2/9/9/9/9/9/5R3/3K5 b - - 0 1", { depth: 3 });
    expect(r.bestmove).toBeNull();
  });
});
