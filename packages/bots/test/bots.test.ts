import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Game, START_FEN } from "xiangqi-core";
import { type BotConfig, chatLine, chooseMove } from "../src/index.js";

const BOTS: BotConfig[] = JSON.parse(readFileSync(new URL("../../../content/bots/bots.json", import.meta.url), "utf8"));
const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const bot = (id: string) => BOTS.find((b) => b.id === id)!;

describe("bot content", () => {
  it("has eight bots in rising strength", () => {
    expect(BOTS.map((b) => b.ratingLabel)).toEqual([250, 400, 600, 800, 1000, 1300, 1600, 2000]);
  });
  it.each(BOTS.map((b) => [b.id, b] as const))("%s: book lines are legal and chat covers every event", (_id, b) => {
    for (const line of b.book) {
      const g = new Game(START_FEN);
      for (const m of line) expect(g.move(m), `${b.id} book ${line.join(" ")}`).not.toBeNull();
    }
    for (const ev of ["greet", "botCheck", "botCapture", "lostPiece", "win", "lose", "draw"] as const) {
      expect(b.chat[ev].length, `${b.id} ${ev}`).toBeGreaterThan(0);
      for (const t of b.chat[ev]) expect(t.en && t.zh).toBeTruthy();
    }
    expect(b.name.en && b.name.zh && b.bio.en && b.bio.zh).toBeTruthy();
  });
});

describe("chooseMove", () => {
  const lines = [
    { multipv: 1, depth: 8, score: { cp: 40 }, pv: ["h2e2"] },
    { multipv: 2, depth: 8, score: { cp: 30 }, pv: ["b0c2"] },
    { multipv: 3, depth: 8, score: { cp: -400 }, pv: ["a3a4"] },
  ];

  it("follows the opening book from the start", () => {
    const c = chooseMove({ bot: bot("laochen"), fen: START_FEN, lines, history: [], rng: seeded(1) });
    expect(c).toEqual({ move: "h2e2", source: "book" });
  });

  it("the strongest bot plays the best line", () => {
    const c = chooseMove({ bot: bot("longwang"), fen: START_FEN, lines, history: null, rng: seeded(1) });
    expect(c).toEqual({ move: "h2e2", source: "engine" });
  });

  it("never picks a candidate beyond the bot's loss limit", () => {
    const b = { ...bot("teacherlin"), book: [] };
    for (let s = 1; s < 200; s++) {
      expect(chooseMove({ bot: b, fen: START_FEN, lines, history: [], rng: seeded(s) })!.move).not.toBe("a3a4");
    }
  });

  it("weak bots sometimes play random legal moves", () => {
    const b = { ...bot("xiaobing"), book: [] };
    const legal = new Game().legalMoves().length;
    const sources = new Set<string>();
    for (let s = 1; s < 200; s++) {
      const c = chooseMove({ bot: b, fen: START_FEN, lines, history: [], rng: seeded(s) })!;
      sources.add(c.source);
    }
    expect(sources.has("random")).toBe(true);
    expect(legal).toBe(44);
  });

  it("scores are taken from the mover's side when Black moves", () => {
    const fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1";
    // Red-view scores: h9g7 is better for Black (more negative).
    const blackLines = [
      { multipv: 1, depth: 8, score: { cp: -20 }, pv: ["h9g7"] },
      { multipv: 2, depth: 8, score: { cp: 300 }, pv: ["a6a5"] },
    ];
    const c = chooseMove({ bot: bot("longwang"), fen, lines: blackLines, history: null });
    expect(c!.move).toBe("h9g7");
  });

  it("returns null with no legal move", () => {
    expect(chooseMove({ bot: bot("longwang"), fen: "R3k4/9/6N2/9/9/9/9/9/5R3/3K5 b - - 0 1", lines: [], history: null })).toBeNull();
  });

  it("gives chat lines", () => {
    expect(chatLine(bot("afu"), "greet")!.zh).toContain("年轻人");
  });
});
