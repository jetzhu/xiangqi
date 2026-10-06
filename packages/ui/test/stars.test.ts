import { describe, expect, it } from "vitest";
import { starsFor } from "../src/bots/stars.js";

describe("bot stars", () => {
  it("follows chess.com: 3 with no help, 2 with 1-3, 1 with 4 or more", () => {
    expect(starsFor(0)).toBe(3);
    expect(starsFor(1)).toBe(2);
    expect(starsFor(3)).toBe(2);
    expect(starsFor(4)).toBe(1);
    expect(starsFor(12)).toBe(1);
  });
});
