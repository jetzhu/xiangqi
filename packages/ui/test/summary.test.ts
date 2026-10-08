import { describe, expect, it } from "vitest";
import { NO_FILTER, filterGames, pct, since, summarize } from "../src/stats/summary.js";
import type { GameRecord } from "../src/store/index.js";

let n = 0;
const g = (over: Partial<GameRecord>): GameRecord => ({
  id: `g${++n}`,
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
  startedAt: `2026-10-0${n}T10:00:00Z`,
  endedAt: `2026-10-0${n}T10:20:00Z`,
  accuracy: null,
  ...over,
});

describe("stats summary", () => {
  n = 0;
  const games = [
    g({}),
    g({ botId: "laoshi", botRating: 1200, rated: true, ratingBefore: 800, ratingAfter: 860 }),
    g({ result: "loss", playerColor: "black", rated: true, ratingBefore: 860, ratingAfter: 830 }),
    g({ result: "draw" }),
    g({ result: null, reason: null }), // unfinished
  ];
  const s = summarize(games);
  it("tallies results overall, by colour and by bot", () => {
    expect(s.all).toEqual({ games: 4, wins: 2, draws: 1, losses: 1 });
    expect(s.black).toEqual({ games: 1, wins: 0, draws: 0, losses: 1 });
    expect(s.byBot.laoshi!.wins).toBe(1);
    expect(pct(s.all.wins, s.all.games)).toBe(50);
  });
  it("finds the best win, the longest win streak and the rating history", () => {
    expect(s.bestWin!.botId).toBe("laoshi");
    expect(s.longestWinStreak).toBe(2);
    expect(s.ratingHistory.map((p) => p.rating)).toEqual([860, 830]);
    expect(since(s.ratingHistory, "2026-10-03T00:00:00Z")).toHaveLength(1);
  });
  it("filters the game list", () => {
    expect(filterGames(games, NO_FILTER)).toHaveLength(4);
    expect(filterGames(games, { ...NO_FILTER, type: "rated" })).toHaveLength(2);
    expect(filterGames(games, { ...NO_FILTER, result: "loss", color: "black" })).toHaveLength(1);
  });
});
