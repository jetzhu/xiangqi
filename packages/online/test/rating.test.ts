import { describe, expect, it } from "vitest";
import { estimatedLength, rateOnlineGame, reconnectWindowMs, speedOf, startingRating, TILES } from "../src/index.js";

describe("time controls", () => {
  it("sorts every tile into its speed", () => {
    for (const [speed, tiles] of Object.entries(TILES)) for (const tc of tiles) expect(speedOf(tc)).toBe(speed);
    expect(estimatedLength({ base: 300, inc: 3 })).toBe(420);
  });

  it("gives a reconnect window of a tenth of the game, 30 s to 3 min", () => {
    expect(reconnectWindowMs({ base: 120, inc: 1 })).toBe(30_000);
    expect(reconnectWindowMs({ base: 600, inc: 5 })).toBe(80_000);
    expect(reconnectWindowMs({ base: 3600, inc: 30 })).toBe(180_000);
    expect(reconnectWindowMs({ base: 600, inc: 5 }, { downMaterial: true })).toBe(40_000);
    expect(reconnectWindowMs({ base: 600, inc: 5 }, { closedTab: true })).toBe(10_000);
  });
});

describe("online rating", () => {
  it("starts from the bot rating, else 800", () => {
    expect(startingRating({ rating: 1234.4 }).rating).toBe(1234);
    expect(startingRating(null)).toEqual({ rating: 800, rd: 200, games: 0, lastPlayed: null });
  });

  it("moves both ratings, the winner up and the loser down", () => {
    const a = { rating: 1200, rd: 80, games: 20, lastPlayed: null };
    const b = { rating: 1200, rd: 80, games: 20, lastPlayed: null };
    const r = rateOnlineGame(a, b, 1);
    expect(r.red.rating).toBeGreaterThan(1200);
    expect(r.black.rating).toBeLessThan(1200);
    expect(r.red.games).toBe(21);
    const d = rateOnlineGame(a, b, 0.5);
    expect(d.red.rating).toBe(1200);
  });

  it("never goes below 100", () => {
    const low = { rating: 105, rd: 200, games: 0, lastPlayed: null };
    expect(rateOnlineGame(low, { rating: 105, rd: 200, games: 0, lastPlayed: null }, 0).red.rating).toBe(100);
  });
});
