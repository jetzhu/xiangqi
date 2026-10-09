import { BOTS, loadPuzzles } from "@xq/content";
import { onboardingOf } from "@xq/puzzles";
import { beforeAll, describe, expect, it } from "vitest";
import { type Backend, type Content, type RatingRow, Stale, handle, restBackend } from "../src/server/record.js";

const U = "00000000-0000-4000-8000-0000000000aa";
const NOW = new Date("2026-10-09T12:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** An in-memory stand-in for the database functions, with their rules (see the migration). */
function fakeDb() {
  const ratings = new Map<string, RatingRow>();
  const games = new Map<string, { user: string; rated: boolean; rating_before: number | null; rating_after: number | null }>();
  const attempts: { user: string; client_id: string; puzzle_id: string; rated: boolean; rating_after: number | null }[] = [];
  /** Runs before the next database call (another device's result landing in between). */
  let interleave: (() => void) | null = null;
  const save = (user: string, kind: string, r: Record<string, unknown>, expected: number) => {
    if ((ratings.get(`${user}/${kind}`)?.games ?? 0) !== expected) throw new Stale();
    ratings.set(`${user}/${kind}`, { rating: r.rating as number, rd: r.rd as number, games: expected + 1, peak: (r.peak as number) ?? null, peak_at: (r.peak_at as string) ?? null, last_played: r.last_played as string });
  };
  const db: Backend = {
    user: async (a) => (a === "Bearer good" ? U : null),
    rating: async (u, k) => ratings.get(`${u}/${k}`) ?? null,
    tried: async (u, p) => attempts.some((a) => a.user === u && a.puzzle_id === p),
    game: async (u, i) => {
      const g = games.get(i);
      return g && g.user === u ? g : null;
    },
    attempt: async (u, c) => attempts.find((a) => a.user === u && a.client_id === c) ?? null,
    async rpc(name, args) {
      const run = interleave;
      interleave = null;
      run?.();
      const r = args.p_rating as Record<string, unknown> | null;
      if (name === "record_bot_game") {
        const g = args.p_game as { id: string };
        if (games.has(g.id)) return false;
        if (r) save(args.p_user as string, "bot", r, args.p_expected_games as number);
        games.set(g.id, { user: args.p_user as string, rated: !!r, rating_before: (r?.before as number) ?? null, rating_after: (r?.rating as number) ?? null });
        return true;
      }
      const a = args.p_attempt as { client_id: string; puzzle_id: string; rating_after: number };
      if (attempts.some((x) => x.client_id === a.client_id)) return false;
      if (r && attempts.some((x) => x.user === args.p_user && x.puzzle_id === a.puzzle_id)) throw new Stale();
      if (r) save(args.p_user as string, "puzzle", r, args.p_expected_games as number);
      attempts.push({ user: args.p_user as string, client_id: a.client_id, puzzle_id: a.puzzle_id, rated: !!r, rating_after: (r?.rating as number) ?? a.rating_after });
      return true;
    },
  };
  return { db, ratings, games, attempts, interleaveOnce: (fn: () => void) => void (interleave = fn) };
}

const post = (body: unknown, auth = "Bearer good") =>
  new Request("https://x.supabase.co/functions/v1/record", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });

const game = (n: number, extra: object = {}) => ({
  type: "bot-game",
  game: {
    id: id(n),
    botId: "laochen",
    playerColor: "red",
    moves: ["h2e2", "h9g7", "h0g2", "i9h9"],
    result: "loss",
    reason: "resign",
    rated: true,
    helps: 0,
    stars: null,
    accuracy: null,
    startedAt: "2026-10-09T10:00:00Z",
    endedAt: "2026-10-09T10:10:00Z",
    ...extra,
  },
});

let content: Content;
beforeAll(async () => {
  content = { bots: BOTS, puzzles: await loadPuzzles() };
});

describe("record: bot games", () => {
  it("saves a checked rated game and returns the new rating", async () => {
    const f = fakeDb();
    const res = await handle(post(game(1)), f.db, content, NOW);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ rated: true, ratingBefore: 800, ratingAfter: expect.any(Number), rating: { games: 1 } });
    expect(out.ratingAfter).toBeLessThan(800);
    expect(f.ratings.get(`${U}/bot`)).toMatchObject({ rating: out.ratingAfter, games: 1, last_played: "2026-10-09T10:10:00.000Z" });
  });

  it("a retried send is saved once and answered with what was saved", async () => {
    const f = fakeDb();
    const first = await (await handle(post(game(1)), f.db, content, NOW)).json();
    const again = await (await handle(post(game(1)), f.db, content, NOW)).json();
    expect(again).toEqual(first);
    expect(f.ratings.get(`${U}/bot`)!.games).toBe(1);
  });

  it("starts again when another result lands first, so neither is lost", async () => {
    const f = fakeDb();
    // Another device's game is saved between reading the rating and saving this one.
    f.interleaveOnce(() => f.ratings.set(`${U}/bot`, { rating: 850, rd: 150, games: 1, peak: null, peak_at: null, last_played: "2026-10-09T10:05:00Z" }));
    const out = await (await handle(post(game(1)), f.db, content, NOW)).json();
    expect(out).toMatchObject({ ratingBefore: 850, rating: { games: 2 } });
    expect(f.ratings.get(`${U}/bot`)!.games).toBe(2);
  });

  it("refuses a result the moves don't support, with a reason, and saves nothing", async () => {
    const f = fakeDb();
    const res = await handle(post(game(1, { result: "win" })), f.db, content, NOW);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/loss/);
    expect(f.games.size).toBe(0);
  });

  it("a casual game is saved without touching the rating; times can't be in the future", async () => {
    const f = fakeDb();
    const out = await (await handle(post(game(1, { rated: false, endedAt: "2030-01-01T00:00:00Z" })), f.db, content, NOW)).json();
    expect(out).toMatchObject({ rated: false, ratingBefore: null, ratingAfter: null, rating: { rating: 800, games: 0 } });
    expect(f.ratings.size).toBe(0);
    expect(f.games.get(id(1))).toMatchObject({ rated: false });
  });

  it("needs a signed-in player", async () => {
    const res = await handle(post(game(1), "Bearer forged"), fakeDb().db, content, NOW);
    expect(res.status).toBe(401);
  });

  it("answers the browser's CORS check", async () => {
    const res = await handle(new Request("https://x/functions/v1/record", { method: "OPTIONS" }), fakeDb().db, content, NOW);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toMatch(/authorization/);
  });
});

describe("record: puzzle attempts", () => {
  const attempt = (n: number, puzzleId: string, moves: string[], extra: object = {}) => ({
    type: "puzzle-attempt",
    attempt: { clientId: id(n), puzzleId, score: 1, rated: true, moves, at: "2026-10-09T11:00:00Z", ...extra },
  });
  let rated: { id: string; moves: string[] };
  let warmUp: { id: string; moves: string[] };
  beforeAll(() => {
    const warm = new Set(onboardingOf(content.puzzles).map((p) => p.id));
    const p = content.puzzles.find((x) => !warm.has(x.id))!;
    rated = { id: p.id, moves: p.solution.filter((_, i) => i % 2 === 0) };
    const w = onboardingOf(content.puzzles)[0]!;
    warmUp = { id: w.id, moves: [w.solution[0]!] };
  });

  it("rates a checked solve the first time only", async () => {
    const f = fakeDb();
    const first = await (await handle(post(attempt(1, rated.id, rated.moves)), f.db, content, NOW)).json();
    expect(first).toMatchObject({ rated: true, rating: { games: 1 } });
    expect(first.ratingAfter).toBeGreaterThan(800);
    const second = await (await handle(post(attempt(2, rated.id, rated.moves)), f.db, content, NOW)).json();
    expect(second).toMatchObject({ rated: false, ratingAfter: first.ratingAfter, rating: { games: 1 } });
    expect(f.attempts).toHaveLength(2);
  });

  it("warm-ups and hinted solves don't count; a made-up solve is refused", async () => {
    const f = fakeDb();
    expect(await (await handle(post(attempt(1, warmUp.id, warmUp.moves)), f.db, content, NOW)).json()).toMatchObject({ rated: false });
    expect(await (await handle(post(attempt(2, rated.id, rated.moves, { score: 0.5 })), f.db, content, NOW)).json()).toMatchObject({ rated: false });
    const fake = await handle(post(attempt(3, content.puzzles[3]!.id, ["a0a1"])), f.db, content, NOW);
    expect(fake.status).toBe(400);
    expect(f.ratings.size).toBe(0);
  });

  it("a miss is rated without needing moves", async () => {
    const f = fakeDb();
    const out = await (await handle(post(attempt(1, rated.id, [], { score: 0 })), f.db, content, NOW)).json();
    expect(out).toMatchObject({ rated: true });
    expect(out.ratingAfter).toBeLessThan(800);
  });
});

describe("restBackend", () => {
  it("reports a 'stale' database error as Stale, and other failures as errors", async () => {
    const reply = (status: number, body: string) => async () => new Response(body, { status });
    await expect(restBackend("https://x", "sb_secret_k", reply(400, '{"code":"40001","message":"stale"}')).rpc("record_bot_game", {})).rejects.toBeInstanceOf(Stale);
    await expect(restBackend("https://x", "sb_secret_k", reply(500, "boom")).rpc("record_bot_game", {})).rejects.toThrow(/500/);
  });

  it("asks Supabase Auth who the token belongs to", async () => {
    const seen: string[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push(`${url} ${(init.headers as Record<string, string>).authorization}`);
      return new Response(JSON.stringify({ id: U }), { status: 200 });
    }) as typeof fetch;
    expect(await restBackend("https://x", "sb_secret_k", fetchFn).user("Bearer tok")).toBe(U);
    expect(await restBackend("https://x", "sb_secret_k", fetchFn).user(null)).toBeNull();
    expect(seen).toEqual(["https://x/auth/v1/user Bearer tok"]);
  });
});
