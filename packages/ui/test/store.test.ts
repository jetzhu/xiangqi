import { describe, expect, it } from "vitest";
import { type GameRecord, createStore, memoryKV } from "../src/store/index.js";

const game = (id: string, startedAt: string, over: Partial<GameRecord> = {}): GameRecord => ({
  id,
  botId: "xiaobing",
  botRating: 250,
  playerColor: "red",
  moves: ["h2e2", "h9g7", "h0g2", "i9h9"],
  result: "win",
  reason: "checkmate",
  rated: false,
  ratingBefore: null,
  ratingAfter: null,
  helps: 0,
  stars: 3,
  startedAt,
  endedAt: startedAt,
  accuracy: null,
  ...over,
});

describe("store", () => {
  it("never downgrades a mastered lesson, and mastering counts for the streak", async () => {
    const s = createStore(memoryKV());
    await s.lessons.setStatus("the-board", "mastered");
    expect((await s.lessons.setStatus("the-board", "started"))["the-board"]).toBe("mastered");
    expect(await s.activity.load()).toHaveLength(1);
    await s.lessons.reset();
    expect(await s.lessons.load()).toEqual({});
  });

  it("keeps the best stars per bot and reads old crowns as one star", async () => {
    const kv = memoryKV();
    await kv.set("bots", "crowns", ["laoshi"]);
    const s = createStore(kv);
    expect(await s.stars.recordWin("xiaobing", 5)).toBe(1);
    expect(await s.stars.recordWin("xiaobing", 0)).toBe(3);
    await s.stars.recordWin("xiaobing", 2);
    expect(await s.stars.load()).toEqual({ xiaobing: 3, laoshi: 1 });
  });

  it("lists games newest first and updates them in place", async () => {
    const s = createStore(memoryKV());
    await s.games.put(game("a", "2026-10-01T10:00:00Z"));
    await s.games.put(game("b", "2026-10-03T10:00:00Z"));
    await s.games.put(game("a", "2026-10-01T10:00:00Z", { accuracy: 88 }));
    const list = await s.games.list();
    expect(list.map((g) => g.id)).toEqual(["b", "a"]);
    expect(list[1]!.accuracy).toBe(88);
  });

  it("starts the bot rating at 800 and keeps Rush bests", async () => {
    const s = createStore(memoryKV());
    expect((await s.botRating.load()).rating).toBe(800);
    expect(await s.rush.save("3", 5)).toBe(true);
    expect(await s.rush.save("3", 4)).toBe(false);
    expect(await s.rush.load()).toEqual({ "3": 5 });
  });
});
