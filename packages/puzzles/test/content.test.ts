// Every generated puzzle must be legal and well-formed. (Engine re-verification is a
// separate, slower script: scripts/verify.mjs.)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Puzzle, validatePuzzle } from "../src/index.js";

const lines = readFileSync(new URL("../../../content/puzzles/generated.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean);
const puzzles: Puzzle[] = lines.map((l) => JSON.parse(l));

describe("puzzle content", () => {
  it("has puzzles", () => {
    expect(puzzles.length).toBeGreaterThan(0);
  });
  it("every puzzle is valid", () => {
    const errors = puzzles.flatMap(validatePuzzle);
    expect(errors).toEqual([]);
  });
  it("ids and positions are unique", () => {
    expect(new Set(puzzles.map((p) => p.id)).size).toBe(puzzles.length);
    expect(new Set(puzzles.map((p) => p.fen.split(" ").slice(0, 2).join(" "))).size).toBe(puzzles.length);
  });
  it("has at least five mates in one for onboarding", () => {
    expect(puzzles.filter((p) => p.themes.includes("mateIn1")).length).toBeGreaterThanOrEqual(5);
  });
});
