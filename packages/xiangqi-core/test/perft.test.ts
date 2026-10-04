import { describe, expect, it } from "vitest";
import { Position, START_FEN } from "../src/position.js";
import { PERFT_CASES } from "./perft-cases.js";

describe("perft from the start position", () => {
  // Widely published Xiangqi perft counts.
  const expected = [44, 1920, 79666, 3290240];
  expected.forEach((n, i) => {
    it(`depth ${i + 1} = ${n}`, () => {
      expect(Position.fromFen(START_FEN).perft(i + 1)).toBe(n);
    });
  });
});

describe("perft on tricky positions (counts from Fairy-Stockfish)", () => {
  for (const c of PERFT_CASES) {
    it(`${c.name}`, () => {
      const p = Position.fromFen(c.fen);
      c.counts.forEach((n, i) => expect(p.perft(i + 1), `depth ${i + 1}`).toBe(n));
    });
  }
});
