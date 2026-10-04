import { describe, expect, it } from "vitest";
import { Game } from "../src/game.js";
import { OPENINGS, isBookMove, openingOf } from "../src/openings.js";
import { START_FEN } from "../src/position.js";

describe("openings", () => {
  it("every catalogue line is legal from the start", () => {
    for (const o of OPENINGS) {
      const g = new Game(START_FEN);
      for (const m of o.moves) expect(g.move(m), `${o.zh}: ${m}`).not.toBeNull();
    }
  });
  it("names the longest matching line", () => {
    expect(openingOf(["h2e2"])?.zh).toBe("中炮");
    expect(openingOf(["h2e2", "h7e7", "h0g2"])?.zh).toBe("顺炮");
    expect(openingOf(["h2e2", "h9g7", "h0g2", "b9c7", "i0h0"])?.en).toBe("Central Cannon vs Screen Horses");
    expect(openingOf(["a3a4"])).toBeNull();
  });
  it("matches mirror images", () => {
    expect(openingOf(["b2e2"])?.zh).toBe("中炮");
    expect(openingOf(["c0e2"])?.zh).toBe("飞相局");
    expect(openingOf(["g3g4"])?.zh).toBe("仙人指路");
  });
  it("knows book moves", () => {
    const g = ["h2e2", "h9g7", "a3a4"];
    expect(isBookMove(g, 0)).toBe(true);
    expect(isBookMove(g, 1)).toBe(true);
    expect(isBookMove(g, 2)).toBe(false);
  });
});
