import { describe, expect, it } from "vitest";
import { Game } from "xiangqi-core";
import { announceMove } from "../src/settings.js";

describe("move announcements", () => {
  const rec = new Game().move("h2e2")!;
  it("speaks the move in the chosen notation and language", () => {
    expect(announceMove(rec, "chinese", "zh")).toBe("红方：炮二平五");
    expect(announceMove(rec, "wxf", "en")).toBe("Red: C2.5");
    expect(announceMove(rec, "iccs", "en", "You")).toBe("You: h2e2");
  });
  it("adds capture and check", () => {
    const g = new Game();
    for (const m of ["h2e2", "h9g7", "e2e6"]) g.move(m);
    const cap = g.history.at(-1)!;
    expect(announceMove(cap, "wxf", "en")).toMatch(/, capture/);
    expect(announceMove(cap, "chinese", "zh")).toMatch(/吃子/);
  });
});
