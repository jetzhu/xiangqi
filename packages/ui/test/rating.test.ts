import { describe, expect, it } from "vitest";
import { NEW_BOT_RATING, isProvisional, rateBotGame, ratingNote } from "../src/bots/rating.js";

describe("bot rating", () => {
  it("gains almost nothing for beating a much weaker bot", () => {
    const strong = { ...NEW_BOT_RATING, rating: 1400, rd: 60 };
    const vsWeak = rateBotGame(strong, 900, 1).rating - 1400;
    const vsNear = rateBotGame(strong, 1300, 1).rating - 1400;
    expect(vsWeak).toBeLessThanOrEqual(1);
    expect(vsNear).toBeGreaterThan(vsWeak);
    // Losing to a much weaker bot still costs the full amount.
    expect(rateBotGame(strong, 900, 0).rating).toBeLessThan(1400 - 10);
  });
  it("is provisional at first and records a peak once settled", () => {
    let r = NEW_BOT_RATING;
    expect(isProvisional(r)).toBe(true);
    for (let i = 0; i < 12; i++) r = rateBotGame(r, 800, i % 2 ? 1 : 0.5, new Date(2026, 9, 7, 10, i));
    expect(isProvisional(r)).toBe(false);
    expect(r.peak).not.toBeNull();
    expect(r.games).toBe(12);
  });
  it("explains unrated games", () => {
    expect(ratingNote(true, 2)).toBe("short");
    expect(ratingNote(false, 10)).toBe("casual");
    expect(ratingNote(true, 10)).toBeNull();
  });
});
