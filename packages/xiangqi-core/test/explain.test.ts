import { describe, expect, it } from "vitest";
import { parseSquare } from "../src/board.js";
import { explainIllegal } from "../src/explain.js";
import { Position, START_FEN } from "../src/position.js";

const why = (fen: string, from: string, to: string) =>
  explainIllegal(Position.fromFen(fen), parseSquare(from), parseSquare(to))?.code ?? null;

describe("explainIllegal", () => {
  it.each([
    [START_FEN, "h2e2", null],
    [START_FEN, "a9a8", "not-your-turn"],
    [START_FEN, "e5e6", "no-piece"],
    [START_FEN, "a0a3", "own-piece"],
    [START_FEN, "e0e2", "general-step"],
    [START_FEN, "d0c1", "palace"],
    [START_FEN, "c0a2", null],
    [START_FEN, "c0b1", "elephant-step"],
    ["4k4/9/9/9/9/2B6/1N7/9/9/3K5 w - - 0 1", "c4e6", "elephant-river"],
    ["4k4/9/9/9/9/2B6/1N7/9/9/3K5 w - - 0 1", "c4a2", "elephant-eye"],
    ["4k4/9/9/9/4P4/4N4/9/9/9/3K5 w - - 0 1", "e4d6", "horse-leg"],
    [START_FEN, "b0b1", "horse-step"],
    [START_FEN, "a0a4", "path-blocked"],
    [START_FEN, "a0b1", "straight-line"],
    [START_FEN, "h2h8", "path-blocked"],
    [START_FEN, "h2h0", "own-piece"],
    ["4k4/9/9/9/4p4/9/9/9/4C4/3K5 w - - 0 1", "e1e5", "cannon-screen"],
    ["4k4/9/9/4p4/4p4/9/4P4/9/4C4/3K5 w - - 0 1", "e1e6", "cannon-one-screen"],
    [START_FEN, "e3e2", "soldier-backward"],
    [START_FEN, "e3d3", "soldier-sideways"],
    ["4k4/9/9/9/9/4C4/9/9/9/4K4 w - - 0 1", "e4d4", "flying-general"],
    ["4k4/9/9/9/9/9/9/9/4r4/3K5 w - - 0 1", "d0d1", "self-check"],
    ["4k4/9/9/9/3r5/9/9/9/9/3K1A3 w - - 0 1", "f0e1", "still-in-check"],
    ["4k4/4r4/9/9/9/9/9/9/9/4KN3 w - - 0 1", "e0d0", null],
  ])("%s %s → %s", (fen, move, code) => {
    expect(why(fen, move.slice(0, 2), move.slice(2))).toBe(code);
  });
  it("has text in both languages", () => {
    const r = explainIllegal(Position.fromFen(START_FEN), parseSquare("e3"), parseSquare("d3"))!;
    expect(r.en).toMatch(/river/);
    expect(r.zh).toMatch(/过河/);
  });
});
