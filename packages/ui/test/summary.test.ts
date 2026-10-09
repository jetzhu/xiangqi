import { describe, expect, it } from "vitest";
import { NO_FILTER, filterGames, pct, puzzlePeak, puzzleThemes, since, summarize } from "../src/stats/summary.js";
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

describe("puzzle stats", () => {
  const h = (id: string, score: 0 | 0.5 | 1, ratingAfter: number, at = `2026-10-0${ratingAfter % 9 + 1}T00:00:00Z`) => ({ id, score, ratingAfter, at });
  const THEMES: Record<string, string[]> = { a: ["fork", "short"], b: ["fork", "mateIn1"], c: ["mateIn1"] };

  it("counts accuracy by theme from first tries, without length tags", () => {
    const history = [h("a", 1, 810), h("b", 0, 800), h("b", 1, 800), h("c", 0.5, 800)];
    expect(puzzleThemes(history, (id) => THEMES[id])).toEqual([
      { theme: "fork", tried: 2, solved: 1 },
      { theme: "mateIn1", tried: 2, solved: 0 },
    ]);
  });

  it("finds the highest puzzle rating and when", () => {
    expect(puzzlePeak([])).toBeNull();
    expect(puzzlePeak([h("a", 1, 820, "2026-10-01T00:00:00Z"), h("b", 1, 860, "2026-10-02T00:00:00Z"), h("c", 0, 840, "2026-10-03T00:00:00Z")])).toEqual({
      rating: 860,
      at: "2026-10-02T00:00:00Z",
    });
  });
});
