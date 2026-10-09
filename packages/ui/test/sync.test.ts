import { afterEach, describe, expect, it } from "vitest";
import type { SavedAnalysis } from "../src/analysis/storage.js";
import type { LessonStatus, Progress } from "../src/learn/progress.js";
import { type GameRecord, createStore } from "../src/store/index.js";
import { hasGuestData, importGuest } from "../src/store/import.js";
import { memoryKV } from "../src/store/kv.js";
import type { BotRating } from "../src/bots/rating.js";
import type { PuzzleRecord } from "../src/puzzles/store.js";
import { type AccountSync, type PlayerState, type PuzzleAttempt, Rejected, type Remote, type StateKey, type SyncedSettings, accountSync } from "../src/store/sync.js";

const RANK: Record<LessonStatus, number> = { new: 0, started: 1, mastered: 2 };

/** The account on a pretend server, with the same rules as the database (packages/db). */
function fakeServer() {
  const db = {
    lessons: {} as Progress,
    state: {} as Partial<PlayerState>,
    analyses: new Map<string, SavedAnalysis>(),
    settings: null as SyncedSettings | null,
    // Written by the record server function in the real thing: here, +10 a win, -10 a loss.
    games: new Map<string, GameRecord>(),
    attempts: [] as PuzzleAttempt[],
    bot: null as BotRating | null,
    puzzle: null as { rating: number; rd: number } | null,
  };
  let offline = false;
  const calls: string[] = [];
  const up = (what: string) => {
    if (offline) throw new Error("Failed to fetch");
    calls.push(what);
  };
  const self = { duringPull: null as null | (() => Promise<unknown>) };
  const remote: Remote = {
    async pull() {
      up("pull");
      await self.duringPull?.();
      return {
        lessons: { ...db.lessons },
        state: structuredClone(db.state),
        analyses: [...db.analyses.values()],
        settings: db.settings,
        records: {
          games: [...db.games.values()].reverse(),
          puzzles: db.attempts.map((a): PuzzleRecord => ({ id: a.puzzleId, score: a.score, ratingAfter: 0, at: a.at, clientId: a.clientId, rated: a.rated })),
          botRating: db.bot && { ...db.bot },
          puzzleRating: db.puzzle && { ...db.puzzle },
        },
      };
    },
    async lessons(p) {
      up("lessons");
      if (Object.keys(p).length === 0) return (db.lessons = {});
      for (const [id, s] of Object.entries(p)) if (RANK[s] >= RANK[db.lessons[id] ?? "new"]) db.lessons[id] = s;
      return Object.fromEntries(Object.keys(p).map((id) => [id, db.lessons[id]!]));
    },
    async state<K extends StateKey>(key: K, value: PlayerState[K]) {
      up(`state:${key}`);
      const old = db.state[key];
      let merged: unknown = value;
      if (Array.isArray(value)) merged = [...new Set([...((old as string[]) ?? []), ...value])].sort().slice(-400);
      else if (old) {
        merged = { ...(old as object) };
        for (const [k, v] of Object.entries(value)) (merged as Record<string, number>)[k] = Math.max((merged as Record<string, number>)[k] ?? 0, v as number);
      }
      db.state[key] = merged as PlayerState[K];
      return structuredClone(merged) as PlayerState[K];
    },
    async saveAnalysis(a) {
      up("saveAnalysis");
      if (a.title === "too long") throw new Rejected("check constraint");
      db.analyses.set(a.id, a);
    },
    async removeAnalysis(id) {
      up("removeAnalysis");
      db.analyses.delete(id);
    },
    async settings(data) {
      up("settings");
      db.settings = data;
    },
    async recordGame(g) {
      up(`game:${g.id}`);
      if (g.reason === "made-up") throw new Rejected("the final position is a loss");
      const saved = db.games.get(g.id);
      const before = db.bot ?? { rating: 800, rd: 200, games: 0, peak: null, peakAt: null, lastPlayed: null };
      if (saved) return { rated: saved.rated, ratingBefore: saved.ratingBefore, ratingAfter: saved.ratingAfter, rating: before };
      const after = g.rated ? { ...before, rating: before.rating + (g.result === "win" ? 10 : g.result === "loss" ? -10 : 0), games: before.games + 1 } : null;
      if (after) db.bot = after;
      db.games.set(g.id, { ...g, ratingBefore: after ? before.rating : null, ratingAfter: after?.rating ?? null });
      return { rated: !!after, ratingBefore: after ? before.rating : null, ratingAfter: after?.rating ?? null, rating: after ?? before };
    },
    async recordPuzzle(a) {
      up(`puzzle:${a.puzzleId}`);
      const before = db.puzzle ?? { rating: 800, rd: 200 };
      if (db.attempts.some((x) => x.clientId === a.clientId)) return { rated: false, ratingAfter: before.rating, rating: before };
      const rated = a.rated && !db.attempts.some((x) => x.puzzleId === a.puzzleId);
      db.attempts.push({ ...a, rated });
      if (rated) db.puzzle = { rating: before.rating + (a.score === 1 ? 10 : -10), rd: 190 };
      return { rated, ratingAfter: (db.puzzle ?? before).rating, rating: db.puzzle ?? before };
    },
    async startingRating(rating) {
      up("startingRating");
      if (db.bot || db.puzzle) return false;
      db.bot = { rating, rd: 200, games: 0, peak: null, peakAt: null, lastPlayed: null };
      db.puzzle = { rating, rd: 200 };
      return true;
    },
  };
  return Object.assign(self, {
    db,
    remote,
    calls,
    setOffline: (v: boolean) => void (offline = v),
  });
}

const open: AccountSync[] = [];
function device(server: ReturnType<typeof fakeServer>) {
  const parts = { cache: memoryKV(), outbox: memoryKV(), device: memoryKV() };
  const sync = accountSync({ ...parts, remote: async () => server.remote });
  open.push(sync);
  return { ...parts, sync, store: createStore(sync.kv) };
}
afterEach(() => {
  for (const s of open.splice(0)) s.stop();
});

const game = (id: string, over: Partial<GameRecord> = {}): GameRecord => ({
  id,
  botId: "xiaobing",
  botRating: 400,
  playerColor: "red",
  moves: ["h2e2", "h9g7", "h0g2", "i9h9"],
  result: "win",
  reason: "checkmate",
  rated: true,
  ratingBefore: 800,
  ratingAfter: 830,
  helps: 0,
  stars: 3,
  startedAt: "2026-10-01T10:00:00.000Z",
  endedAt: "2026-10-01T10:05:00.000Z",
  accuracy: null,
  ...over,
});

describe("account sync", () => {
  it("saves to this browser at once and to the account on flush", async () => {
    const server = fakeServer();
    const a = device(server);
    await a.store.lessons.setStatus("board", "mastered");
    await a.store.stars.recordWin("xiaobing", 0);
    expect(await a.store.lessons.load()).toEqual({ board: "mastered" });
    expect(server.db.lessons).toEqual({});
    expect(await a.sync.flush()).toBe(true);
    expect(server.db.lessons).toEqual({ board: "mastered" });
    expect(server.db.state.stars).toEqual({ xiaobing: 3 });
    expect(server.db.state.activity).toHaveLength(1);
  });

  it("sends a finished game to be recorded; the server's rating replaces this browser's", async () => {
    const server = fakeServer();
    const a = device(server);
    // In progress: kept on this device only.
    await a.store.games.put(game("g1", { result: null, endedAt: null }));
    await a.sync.flush();
    expect(server.calls).toEqual([]);
    expect(await a.device.get("games", "g1")).toBeTruthy();
    // Finished, with the rating this browser worked out (830).
    await a.store.games.put(game("g1"));
    await a.store.botRating.save({ rating: 830, rd: 190, games: 1, peak: null, peakAt: null, lastPlayed: null });
    expect((await a.store.botRating.load()).rating).toBe(830);
    await a.sync.flush();
    expect(server.calls).toEqual(["game:g1"]);
    expect(await a.device.get("games", "g1")).toBeUndefined();
    expect(await a.store.games.list()).toMatchObject([{ id: "g1", ratingBefore: 800, ratingAfter: 810 }]);
    expect((await a.store.botRating.load()).rating).toBe(810);
  });

  it("drops a game the server refuses, and the next pull removes it", async () => {
    const server = fakeServer();
    const a = device(server);
    await a.store.games.put(game("g1", { reason: "made-up" }));
    expect(await a.sync.flush()).toBe(true);
    expect(server.db.games.size).toBe(0);
    await a.sync.pull();
    expect(await a.store.games.list()).toEqual([]);
  });

  it("sends each new puzzle attempt once; older attempts without moves aren't sent", async () => {
    const server = fakeServer();
    const a = device(server);
    const old: PuzzleRecord = { id: "p0", score: 1, ratingAfter: 810, at: "2026-10-01T09:00:00.000Z" };
    const p1: PuzzleRecord = { id: "p1", score: 1, ratingAfter: 815, at: "2026-10-09T09:00:00.000Z", clientId: "c1", rated: true, moves: ["h2e2"] };
    await a.store.puzzles.save({ rating: { rating: 815, rd: 190 }, history: [old, p1] });
    await a.sync.flush();
    const p2: PuzzleRecord = { id: "p2", score: 0, ratingAfter: 800, at: "2026-10-09T09:05:00.000Z", clientId: "c2", rated: true, moves: [] };
    await a.store.puzzles.save({ rating: { rating: 800, rd: 185 }, history: [old, p1, p2] });
    await a.sync.flush();
    expect(server.calls).toEqual(["puzzle:p1", "puzzle:p2"]);
    expect(server.db.attempts.map((x) => [x.puzzleId, x.moves, x.rated])).toEqual([
      ["p1", ["h2e2"], true],
      ["p2", [], true],
    ]);
    expect((await a.store.puzzles.load()).rating).toEqual({ rating: 800, rd: 190 });
  });

  it("brings games, puzzle attempts and ratings from another device", async () => {
    const server = fakeServer();
    const laptop = device(server);
    const phone = device(server);
    expect(await phone.sync.pull()).toMatchObject({ newPlayer: true });
    await laptop.store.games.put(game("g1"));
    await laptop.store.puzzles.save({ rating: { rating: 810, rd: 190 }, history: [{ id: "p1", score: 1, ratingAfter: 810, at: "2026-10-09T09:00:00.000Z", clientId: "c1", rated: true, moves: ["h2e2"] }] });
    await laptop.sync.flush();
    expect(await phone.sync.pull()).toMatchObject({ changed: true, newPlayer: false });
    expect((await phone.store.games.list()).map((g) => g.id)).toEqual(["g1"]);
    expect((await phone.store.botRating.load()).rating).toBe(810);
    expect(await phone.store.puzzles.load()).toMatchObject({ rating: { rating: 810 }, history: [{ id: "p1", clientId: "c1" }] });
  });

  it("sends games kept on this device before the server could check them, oldest first", async () => {
    const server = fakeServer();
    const a = device(server);
    // What M11 left on the device for this account.
    await a.device.set("games", "later", game("later", { startedAt: "2026-10-08T12:00:00.000Z" }));
    await a.device.set("games", "earlier", game("earlier", { startedAt: "2026-10-08T10:00:00.000Z" }));
    await a.device.set("games", "playing", game("playing", { result: null, endedAt: null }));
    await a.device.set("puzzles", "state", { rating: { rating: 900, rd: 150 }, history: [{ id: "p1", score: 1, ratingAfter: 900, at: "2026-10-08T09:00:00.000Z" }] });
    await a.device.set("ratings", "bot", { rating: 900, rd: 100, games: 2, peak: null, peakAt: null, lastPlayed: null });
    await a.sync.pull();
    expect(server.calls.filter((c) => c.startsWith("game:"))).toEqual(["game:earlier", "game:later"]);
    expect((await a.store.botRating.load()).rating).toBe(820);
    expect(await a.device.get("puzzles", "state")).toBeUndefined();
    expect((await a.store.games.list()).map((g) => g.id).sort()).toEqual(["earlier", "later", "playing"]);
  });

  it("sets the starting rating once, from the skill question", async () => {
    const server = fakeServer();
    const a = device(server);
    expect(await a.sync.startingRating(1200)).toBe(true);
    expect((await a.store.botRating.load()).rating).toBe(1200);
    expect((await a.store.puzzles.load()).rating.rating).toBe(1200);
    expect(await a.sync.startingRating(400)).toBe(false);
    expect(await a.sync.pull()).toMatchObject({ newPlayer: false });
  });

  it("keeps writes made offline and sends them later", async () => {
    const server = fakeServer();
    const a = device(server);
    server.setOffline(true);
    await a.store.lessons.setStatus("horse", "started");
    expect(await a.sync.flush()).toBe(false);
    expect(await a.store.lessons.load()).toEqual({ horse: "started" });
    server.setOffline(false);
    expect(await a.sync.flush()).toBe(true);
    expect(server.db.lessons).toEqual({ horse: "started" });
  });

  it("brings progress from another device, and never undoes it", async () => {
    const server = fakeServer();
    const laptop = device(server);
    const phone = device(server);
    await laptop.store.lessons.setStatus("board", "mastered");
    await laptop.store.stars.recordWin("afu", 5);
    await laptop.store.rush.save("3", 12);
    await laptop.store.analyses.save("Opening idea", "1. h2e2");
    await laptop.sync.flush();

    // The phone, still behind, sends what it knows: the server keeps the better of each.
    await phone.store.lessons.setStatus("board", "started");
    await phone.store.stars.recordWin("afu", 0);
    await phone.sync.flush();
    expect(server.db.lessons.board).toBe("mastered");
    expect(server.db.state.stars).toEqual({ afu: 3 });
    // The merged values come back into the phone's cache.
    expect(await phone.store.lessons.load()).toEqual({ board: "mastered" });

    const pulled = await phone.sync.pull();
    expect(pulled?.changed).toBe(true);
    expect(await phone.store.rush.load()).toEqual({ "3": 12 });
    expect((await phone.store.analyses.list()).map((x) => x.title)).toEqual(["Opening idea"]);

    // Deleted on the laptop: gone from the phone after its next pull.
    const [saved] = await laptop.store.analyses.list();
    await laptop.store.analyses.remove(saved!.id);
    await laptop.sync.flush();
    await phone.sync.pull();
    expect(await phone.store.analyses.list()).toEqual([]);
    expect((await phone.sync.pull())?.changed).toBe(false);
  });

  it("doesn't pull while offline, and lets unsent writes win over a pull", async () => {
    const server = fakeServer();
    const a = device(server);
    server.db.lessons = { board: "started" };
    server.setOffline(true);
    await a.store.lessons.setStatus("cannon", "started");
    expect(await a.sync.pull()).toBeNull();
    server.setOffline(false);
    expect(await a.sync.pull()).toMatchObject({ changed: true });
    expect(await a.store.lessons.load()).toEqual({ board: "started", cannon: "started" });
  });

  it("resets lessons on the account when they are reset in Settings", async () => {
    const server = fakeServer();
    const a = device(server);
    await a.store.lessons.setStatus("board", "mastered");
    await a.sync.flush();
    await a.store.lessons.reset();
    await a.sync.flush();
    expect(server.db.lessons).toEqual({});
  });

  it("drops a write the server refuses for good instead of retrying it forever", async () => {
    const server = fakeServer();
    const a = device(server);
    await a.store.analyses.save("too long", "");
    await a.store.lessons.setStatus("board", "started");
    expect(await a.sync.flush()).toBe(true);
    expect(server.db.lessons).toEqual({ board: "started" });
    expect(server.db.analyses.size).toBe(0);
  });

  it("saves settings and returns them on the next pull", async () => {
    const server = fakeServer();
    const a = device(server);
    await a.sync.saveSettings({ notation: "wxf" });
    expect((await a.sync.pull())?.settings).toEqual({ notation: "wxf" });
    // Changed again while the pull was on its way: the pull must not bring back the older value.
    server.duringPull = () => a.sync.saveSettings({ notation: "iccs" });
    expect((await a.sync.pull())?.settings).toBe("pending");
    server.duringPull = null;
    await a.sync.flush();
    expect(server.db.settings).toEqual({ notation: "iccs" });
  });

  it("forgets the account's data at sign-out, but not a game in progress here", async () => {
    const server = fakeServer();
    const a = device(server);
    server.setOffline(true);
    await a.store.lessons.setStatus("board", "started");
    await a.store.games.put(game("g1"));
    await a.store.games.put(game("g2", { result: null, endedAt: null }));
    await a.sync.clear();
    expect(await a.store.lessons.load()).toEqual({});
    expect(await a.outbox.entries("local")).toEqual([]);
    expect((await a.store.games.list()).map((g) => g.id)).toEqual(["g2"]);
  });
});

describe("guest import", () => {
  async function guestWithProgress() {
    const kv = memoryKV();
    const g = createStore(kv);
    await g.lessons.setStatus("board", "mastered");
    await g.lessons.setStatus("horse", "started");
    await kv.set("bots", "crowns", ["afu"]); // a v0.1 crown
    await g.stars.recordWin("xiaobing", 2);
    await g.rush.save("3", 7);
    await g.daily.mark("2026-10-01");
    await g.analyses.save("Guest analysis", "1. h2e2");
    await g.games.put(game("won"));
    await g.games.put(game("unfinished", { result: null, endedAt: null }));
    await g.botRating.save({ rating: 1100, rd: 80, games: 5, peak: null, peakAt: null, lastPlayed: null });
    await g.puzzles.save({
      rating: { rating: 950, rd: 120 },
      history: [
        // From before M12: no moves, so the server can't check it.
        { id: "p1", score: 1, ratingAfter: 930, at: "2026-10-01T09:00:00.000Z" },
        { id: "p2", score: 1, ratingAfter: 950, at: "2026-10-02T09:00:00.000Z", clientId: "c2", rated: true, moves: ["h2e2"] },
      ],
    });
    return kv;
  }

  it("moves guest progress into a new account with the merge rules", async () => {
    const server = fakeServer();
    const a = device(server);
    const guest = await guestWithProgress();
    expect(await hasGuestData(guest)).toBe(true);

    const summary = await importGuest(guest, a.sync.kv);
    expect(summary).toEqual({ lessons: 2, puzzles: 1, games: 1, analyses: 1 });
    expect(await a.store.lessons.load()).toEqual({ board: "mastered", horse: "started" });
    expect(await a.store.stars.load()).toEqual({ afu: 1, xiaobing: 2 });
    // Games become casual, so the account's bot rating starts fresh.
    const games = await a.store.games.list();
    expect(games.map((x) => [x.id, x.rated, x.ratingAfter])).toEqual([["won", false, null]]);
    expect((await a.store.botRating.load()).games).toBe(0);
    // Puzzle attempts the server can check join the history unrated: the account's rating is its own.
    expect(await a.store.puzzles.load()).toMatchObject({ rating: { rating: 800 }, history: [{ id: "p2", rated: false }] });

    await a.sync.flush();
    expect(server.db.lessons).toEqual({ board: "mastered", horse: "started" });
    expect(server.db.analyses.size).toBe(1);
    expect(server.db.state.rush).toEqual({ "3": 7 });
    expect(server.db.state.daily).toEqual(["2026-10-01"]);
    expect([...server.db.games.values()].map((g) => [g.id, g.rated])).toEqual([["won", false]]);
    expect(server.db.bot).toBeNull();
    expect(server.db.attempts.map((x) => [x.puzzleId, x.rated])).toEqual([["p2", false]]);

    // The guest copy is gone: nothing to import a second time.
    expect(await hasGuestData(guest)).toBe(false);
    expect(await createStore(guest).botRating.load()).toMatchObject({ games: 0 });
  });

  it("keeps the better of each and the account's puzzle rating when the account has one", async () => {
    const server = fakeServer();
    const a = device(server);
    await a.store.lessons.setStatus("board", "started");
    await a.store.lessons.setStatus("cannon", "mastered");
    await a.store.stars.recordWin("xiaobing", 0);
    await a.store.puzzles.save({ rating: { rating: 1300, rd: 60 }, history: [{ id: "p9", score: 1, ratingAfter: 1300, at: "2026-10-05T09:00:00.000Z" }] });

    await importGuest(await guestWithProgress(), a.sync.kv);
    expect(await a.store.lessons.load()).toEqual({ board: "mastered", cannon: "mastered", horse: "started" });
    expect((await a.store.stars.load()).xiaobing).toBe(3);
    const puzzles = await a.store.puzzles.load();
    expect(puzzles.rating.rating).toBe(1300);
    expect(puzzles.history.map((h) => h.id)).toEqual(["p2", "p9"]);
  });

  it("finds nothing to import in a fresh browser", async () => {
    expect(await hasGuestData(memoryKV())).toBe(false);
  });
});
