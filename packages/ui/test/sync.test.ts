import { afterEach, describe, expect, it } from "vitest";
import type { SavedAnalysis } from "../src/analysis/storage.js";
import type { LessonStatus, Progress } from "../src/learn/progress.js";
import { type GameRecord, createStore } from "../src/store/index.js";
import { hasGuestData, importGuest } from "../src/store/import.js";
import { memoryKV } from "../src/store/kv.js";
import { type AccountSync, type PlayerState, Rejected, type Remote, type StateKey, type SyncedSettings, accountSync } from "../src/store/sync.js";

const RANK: Record<LessonStatus, number> = { new: 0, started: 1, mastered: 2 };

/** The account on a pretend server, with the same rules as the database (packages/db). */
function fakeServer() {
  const db = {
    lessons: {} as Progress,
    state: {} as Partial<PlayerState>,
    analyses: new Map<string, SavedAnalysis>(),
    settings: null as SyncedSettings | null,
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
      return { lessons: { ...db.lessons }, state: structuredClone(db.state), analyses: [...db.analyses.values()], settings: db.settings };
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

  it("keeps games, puzzles and the bot rating on this device until the server can check them", async () => {
    const server = fakeServer();
    const a = device(server);
    await a.store.games.put(game("g1"));
    await a.store.puzzles.save({ rating: { rating: 900, rd: 150 }, history: [] });
    await a.sync.flush();
    expect(server.calls).toEqual([]);
    expect(await a.device.get("games", "g1")).toBeTruthy();
    expect(await a.store.games.list()).toHaveLength(1);
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

  it("forgets the account's data at sign-out, but not the records kept on this device", async () => {
    const server = fakeServer();
    const a = device(server);
    server.setOffline(true);
    await a.store.lessons.setStatus("board", "started");
    await a.store.games.put(game("g1"));
    await a.sync.clear();
    expect(await a.store.lessons.load()).toEqual({});
    expect(await a.outbox.entries("local")).toEqual([]);
    expect(await a.store.games.list()).toHaveLength(1);
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
    await g.puzzles.save({ rating: { rating: 950, rd: 120 }, history: [{ id: "p1", score: 1, ratingAfter: 950, at: "2026-10-01T09:00:00.000Z" }] });
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
    // No puzzle rating in the account yet: the guest's becomes its starting rating.
    expect((await a.store.puzzles.load()).rating.rating).toBe(950);

    await a.sync.flush();
    expect(server.db.lessons).toEqual({ board: "mastered", horse: "started" });
    expect(server.db.analyses.size).toBe(1);
    expect(server.db.state.rush).toEqual({ "3": 7 });
    expect(server.db.state.daily).toEqual(["2026-10-01"]);

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
    expect(puzzles.history.map((h) => h.id)).toEqual(["p1", "p9"]);
  });

  it("finds nothing to import in a fresh browser", async () => {
    expect(await hasGuestData(memoryKV())).toBe(false);
  });
});
