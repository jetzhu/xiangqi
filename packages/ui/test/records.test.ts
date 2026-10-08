import { describe, expect, it } from "vitest";
import { claimGame, finishGame, settleAbandoned } from "../src/bots/records.js";
import { type GameRecord, createStore, memoryKV } from "../src/store/index.js";

const base = (over: Partial<GameRecord> = {}): GameRecord => ({
  id: "g1",
  botId: "xiaobing",
  botRating: 800,
  playerColor: "red",
  moves: ["h2e2", "h9g7", "h0g2", "i9h9"],
  result: null,
  reason: null,
  rated: true,
  ratingBefore: null,
  ratingAfter: null,
  helps: 0,
  stars: null,
  startedAt: "2026-10-07T10:00:00Z",
  endedAt: null,
  accuracy: null,
  ...over,
});

describe("bot game records", () => {
  it("rates and saves a rated game", async () => {
    const s = createStore(memoryKV());
    const out = await finishGame(s, base(), "win", "checkmate");
    expect(out.ratingBefore).toBe(800);
    expect(out.ratingAfter).toBeGreaterThan(800);
    expect((await s.botRating.load()).rating).toBe(out.ratingAfter);
    expect((await s.games.list())[0]!.result).toBe("win");
  });
  it("saves a casual game without touching the rating", async () => {
    const s = createStore(memoryKV());
    const out = await finishGame(s, base({ rated: false }), "loss", "resign");
    expect(out.ratingAfter).toBeNull();
    expect((await s.botRating.load()).games).toBe(0);
    expect(await s.games.list()).toHaveLength(1);
  });
  it("neither saves nor rates a game under 4 plies", async () => {
    const s = createStore(memoryKV());
    await finishGame(s, base({ moves: ["h2e2", "h9g7"] }), "loss", "resign");
    expect(await s.games.list()).toHaveLength(0);
    expect((await s.botRating.load()).games).toBe(0);
  });
  it("settles a rated game left in progress as a loss", async () => {
    const s = createStore(memoryKV());
    await s.games.put(base());
    await s.games.put(base({ id: "casual", rated: false }));
    expect(await settleAbandoned(s)).toBe(1);
    const g = await s.games.get("g1");
    expect(g!.result).toBe("loss");
    expect(g!.reason).toBe("abandoned");
    expect(g!.ratingAfter).toBeLessThan(800);
    expect(await settleAbandoned(s)).toBe(0);
  });
  it("doesn't settle a game that is being finished", async () => {
    const s = createStore(memoryKV());
    await s.games.put(base({ id: "busy" }));
    claimGame("busy");
    expect(await settleAbandoned(s)).toBe(0);
    await finishGame(s, base({ id: "busy" }), "win", "checkmate");
    expect((await s.games.get("busy"))!.result).toBe("win");
    expect(await settleAbandoned(s)).toBe(0);
  });
});
