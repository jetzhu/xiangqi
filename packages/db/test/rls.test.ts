// Runs the migrations in an in-memory Postgres (PGlite) with a stand-in for the parts of
// Supabase they rely on: the anon/authenticated roles, auth.users and auth.uid(), and
// Supabase's default grants on new tables. Then checks one user can't reach another's rows.
import { readFileSync, readdirSync } from "node:fs";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const SUPABASE_STANDIN = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  -- As on Supabase: new tables in public are open to every API role until a migration says otherwise.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

const migrations = new URL("../supabase/migrations/", import.meta.url);
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

let db: PGlite;

/** Runs `fn` as a signed-in user (or the anonymous visitor), then rolls everything back. */
async function as<T>(user: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  let out!: T;
  await db
    .transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ?? ""]);
      await tx.exec(`set local role ${user ? "authenticated" : "anon"}`);
      out = await fn(tx);
      await tx.rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Error && /rollback/i.test(e.message))) throw e;
    });
  return out;
}

/** Same as `as`, but expects the statements to fail and returns the error message. */
const failsAs = (user: string | null, sql: string) =>
  as(user, async (tx) => {
    try {
      await tx.exec(sql);
    } catch (e) {
      return (e as Error).message;
    }
    return "no error";
  });

const signUp = (id: string, meta: object) =>
  db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${id.slice(-1)}@example.com`, JSON.stringify(meta)]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const f of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(new URL(f, migrations), "utf8"));
  }
  await signUp(A, { username: "Alice_1", lang: "en" });
  await signUp(B, { username: "bob-xq" });
  // Rows the server functions would write, one set per user.
  for (const u of [A, B]) {
    await db.query(`insert into public.settings (user_id, data) values ($1, '{"notation":"wxf"}')`, [u]);
    await db.query(`insert into public.lesson_progress (user_id, lesson_id, status) values ($1, 'board', 'started')`, [u]);
    await db.query(`insert into public.analyses (user_id, title, data) values ($1, 'mine', '{}')`, [u]);
    await db.query(
      `insert into public.bot_games (user_id, bot_id, bot_rating, player_color, moves, result, rated, started_at)
       values ($1, 'laochen', 800, 'red', '{h2e2,h7e7}', 'win', true, now())`,
      [u],
    );
    await db.query(`insert into public.puzzle_attempts (user_id, puzzle_id, score) values ($1, 'p1', 1)`, [u]);
    await db.query(`insert into public.ratings (user_id, kind, rating, rd) values ($1, 'bot', 800, 200)`, [u]);
    await db.query(`insert into public.player_state (user_id, key, value) values ($1, 'stars', '{"xiaobing": 1}')`, [u]);
  }
});

describe("sign-up", () => {
  it("makes a profile with the chosen username and language", async () => {
    const { rows } = await db.query<{ username: string; lang: string }>(`select username, lang from public.profiles order by username`);
    expect(rows).toEqual([
      { username: "Alice_1", lang: "en" },
      { username: "bob-xq", lang: "zh" },
    ]);
  });

  it("falls back to a placeholder when the name is taken, reserved or malformed", async () => {
    const ids = ["c", "d", "e", "f"].map((c) => `00000000-0000-4000-8000-00000000000${c}`);
    await signUp(ids[0]!, { username: "ALICE_1" });
    await signUp(ids[1]!, { username: "Admin" });
    await signUp(ids[2]!, { username: "-x" });
    await signUp(ids[3]!, {});
    const { rows } = await db.query<{ username: string }>(`select username from public.profiles where user_id = any($1)`, [ids]);
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.username).toMatch(/^player-\d{7}$/);
    await db.query(`delete from auth.users where id = any($1)`, [ids]);
  });

  it("explains why a username can't be used, to anyone", async () => {
    const problems = await as(null, async (tx) => {
      const names = ["ok_name", "alice_1", "xiaobing", "12345", "ab", "a".repeat(21), "bad name", "_lead", "中文名字"];
      const out: Record<string, string | null> = {};
      for (const n of names) out[n] = (await tx.query<{ p: string | null }>(`select public.username_problem($1) as p`, [n])).rows[0]!.p;
      return out;
    });
    expect(problems).toEqual({
      ok_name: null,
      alice_1: "taken",
      xiaobing: "reserved",
      "12345": "digits",
      ab: "format",
      ["a".repeat(21)]: "format",
      "bad name": "format",
      _lead: "format",
      中文名字: "format",
    });
  });
});

describe("row-level security", () => {
  const OWN_TABLES = ["profiles", "settings", "lesson_progress", "analyses", "player_state", "bot_games", "puzzle_attempts", "ratings"];

  it("shows a user only their own rows in every table", async () => {
    const counts = await as(A, async (tx) => {
      const out: Record<string, string[]> = {};
      for (const t of OWN_TABLES) out[t] = (await tx.query<{ user_id: string }>(`select distinct user_id from public.${t}`)).rows.map((r) => r.user_id);
      return out;
    });
    for (const t of OWN_TABLES) expect(counts[t], t).toEqual([A]);
  });

  it("can't change or delete another user's rows", async () => {
    const changed = await as(A, async (tx) => {
      const n = async (sql: string) => (await tx.query(sql, [B])).affectedRows ?? 0;
      return [
        await n(`update public.settings set data = '{}' where user_id = $1`),
        await n(`update public.lesson_progress set status = 'mastered' where user_id = $1`),
        await n(`update public.profiles set avatar = 'x' where user_id = $1`),
        await n(`delete from public.analyses where user_id = $1`),
        await n(`delete from public.settings where user_id = $1`),
        await n(`update public.player_state set value = '{}' where user_id = $1`),
      ];
    });
    expect(changed).toEqual([0, 0, 0, 0, 0, 0]);
    const left = await db.query(`select 1 from public.analyses where user_id = $1`, [B]);
    expect(left.rows).toHaveLength(1);
  });

  it("can't write rows owned by someone else", async () => {
    expect(await failsAs(A, `insert into public.analyses (user_id, data) values ('${B}', '{}')`)).toMatch(/row-level security/);
    expect(await failsAs(A, `insert into public.lesson_progress (user_id, lesson_id, status) values ('${B}', 'x', 'new')`)).toMatch(/row-level security/);
    expect(await failsAs(A, `update public.settings set user_id = '${B}'`)).toMatch(/row-level security/);
    expect(await failsAs(A, `insert into public.player_state (user_id, key, value) values ('${B}', 'rush', '{}')`)).toMatch(/row-level security/);
  });

  it("can write their own progress, settings and analyses", async () => {
    const id = await as(A, async (tx) => {
      await tx.exec(`insert into public.lesson_progress (user_id, lesson_id, status) values ('${A}', 'horse', 'mastered')`);
      await tx.exec(`update public.settings set data = '{"notation":"chinese"}'`);
      return (await tx.query<{ user_id: string }>(`insert into public.analyses (data) values ('{}') returning user_id`)).rows[0]!.user_id;
    });
    expect(id).toBe(A);
  });

  it("leaves ratings, games and puzzle attempts to the server", async () => {
    expect(await failsAs(A, `update public.ratings set rating = 3000`)).toMatch(/permission denied/);
    expect(await failsAs(A, `insert into public.ratings (user_id, kind, rating, rd) values ('${A}', 'puzzle', 3000, 50)`)).toMatch(/permission denied/);
    expect(await failsAs(A, `delete from public.bot_games`)).toMatch(/permission denied/);
    expect(await failsAs(A, `insert into public.puzzle_attempts (user_id, puzzle_id, score) values ('${A}', 'p', 1)`)).toMatch(/permission denied/);
    expect(await failsAs(A, `insert into public.profiles (user_id, username) values ('${A}', 'another')`)).toMatch(/permission denied/);
    expect(await failsAs(A, `update public.profiles set created_at = now() - interval '9 years'`)).toMatch(/permission denied/);
  });

  it("shows the anonymous visitor nothing", async () => {
    for (const t of [...OWN_TABLES, "reserved_usernames"]) {
      expect(await failsAs(null, `select * from public.${t}`), t).toMatch(/permission denied/);
    }
    expect(await failsAs(A, `select * from public.reserved_usernames`)).toMatch(/permission denied/);
  });
});

describe("rules kept by the database", () => {
  it("never lowers a lesson's status", async () => {
    const status = await as(A, async (tx) => {
      await tx.exec(`update public.lesson_progress set status = 'mastered' where lesson_id = 'board'`);
      await tx.exec(`update public.lesson_progress set status = 'new' where lesson_id = 'board'`);
      return (await tx.query<{ status: string }>(`select status from public.lesson_progress where lesson_id = 'board'`)).rows[0]!.status;
    });
    expect(status).toBe("mastered");
  });

  it("merges stars, Rush bests and days sent from different devices", async () => {
    const upsert = (key: string, value: unknown) =>
      `insert into public.player_state (key, value) values ('${key}', '${JSON.stringify(value)}')
       on conflict (user_id, key) do update set value = excluded.value`;
    const merged = await as(A, async (tx) => {
      await tx.exec(upsert("stars", { xiaobing: 3, afu: 1 }));
      await tx.exec(upsert("stars", { xiaobing: 2, afu: 2, laochen: 1 }));
      await tx.exec(upsert("rush", { three: 12 }));
      await tx.exec(upsert("rush", { three: 9, five: 20 }));
      await tx.exec(upsert("activity", ["2026-10-02", "2026-10-01"]));
      await tx.exec(upsert("activity", ["2026-10-03", "2026-10-01"]));
      const rows = (await tx.query<{ key: string; value: unknown }>(`select key, value from public.player_state order by key`)).rows;
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    });
    expect(merged).toEqual({
      activity: ["2026-10-01", "2026-10-02", "2026-10-03"],
      rush: { five: 20, three: 12 },
      stars: { afu: 2, laochen: 1, xiaobing: 3 },
    });
  });

  it("keeps the newest 400 days and refuses values of the wrong shape", async () => {
    const days = (from: number, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2025, 0, from + i)).toISOString().slice(0, 10));
    const kept = await as(A, async (tx) => {
      await tx.query(`insert into public.player_state (key, value) values ('daily', $1)`, [JSON.stringify(days(1, 300))]);
      await tx.query(`update public.player_state set value = $1 where key = 'daily'`, [JSON.stringify(days(301, 200))]);
      return (await tx.query<{ value: string[] }>(`select value from public.player_state where key = 'daily'`)).rows[0]!.value;
    });
    expect(kept).toHaveLength(400);
    expect(kept[0]).toBe(days(101, 1)[0]);
    expect(kept.at(-1)).toBe(days(500, 1)[0]);
    expect(await failsAs(A, `insert into public.player_state (key, value) values ('daily', '{}')`)).toMatch(/check constraint/);
    expect(await failsAs(A, `insert into public.player_state (key, value) values ('rating', '{}')`)).toMatch(/check constraint/);
  });

  it("allows one username change every 90 days, to a free name", async () => {
    expect(await failsAs(A, `update public.profiles set username = 'BOB-XQ'`)).toMatch(/taken/);
    expect(await failsAs(A, `update public.profiles set username = 'x y'`)).toMatch(/format/);
    const second = await as(A, async (tx) => {
      await tx.exec(`update public.profiles set username = 'alice_2'`);
      try {
        await tx.exec(`update public.profiles set username = 'alice_3'`);
      } catch (e) {
        return (e as Error).message;
      }
      return "no error";
    });
    expect(second).toMatch(/90 days/);
    // Changing only the letter case of the current name, or other columns, is not blocked.
    expect(await failsAs(A, `update public.profiles set avatar = 'horse', country = 'GB'`)).toBe("no error");
  });

  it("asks Google/Microsoft/GitHub sign-ups to choose a name, without starting the 90-day wait", async () => {
    const C = "00000000-0000-4000-8000-0000000000c1";
    await signUp(C, { full_name: "Carol Example", provider_id: "123" });
    const before = await db.query<{ username: string; username_chosen: boolean }>(`select username, username_chosen from public.profiles where user_id = $1`, [C]);
    expect(before.rows[0]!.username).toMatch(/^player-\d{7}$/);
    expect(before.rows[0]!.username_chosen).toBe(false);
    const after = await as(C, async (tx) => {
      await tx.exec(`update public.profiles set username = 'carol_xq'`);
      const row = (await tx.query<{ username_chosen: boolean; username_changed_at: string | null }>(`select username_chosen, username_changed_at from public.profiles`)).rows[0]!;
      // One real change is still allowed, then the wait applies.
      await tx.exec(`update public.profiles set username = 'carol_2'`);
      let third = "no error";
      try {
        await tx.exec(`update public.profiles set username = 'carol_3'`);
      } catch (e) {
        third = (e as Error).message;
      }
      return { ...row, third };
    });
    expect(after).toEqual({ username_chosen: true, username_changed_at: null, third: expect.stringMatching(/90 days/) });
    expect(await failsAs(C, `update public.profiles set username_chosen = true`)).toMatch(/permission denied/);
    await db.query(`delete from auth.users where id = $1`, [C]);
  });

  it("marks a name picked at email sign-up as chosen", async () => {
    const { rows } = await db.query<{ username_chosen: boolean }>(`select username_chosen from public.profiles where user_id = $1`, [A]);
    expect(rows[0]!.username_chosen).toBe(true);
  });

  it("deletes everything with the account", async () => {
    await db.query(`delete from auth.users where id = $1`, [B]);
    for (const t of ["profiles", "settings", "lesson_progress", "analyses", "player_state", "bot_games", "puzzle_attempts", "ratings"]) {
      const { rows } = await db.query(`select 1 from public.${t} where user_id = $1`, [B]);
      expect(rows, t).toHaveLength(0);
    }
  });
});

describe("recording results (M12 server functions)", () => {
  const D = "00000000-0000-4000-8000-00000000000d";
  const GAME = "11111111-1111-4111-8111-111111111111";
  const game = (id = GAME) =>
    JSON.stringify({ id, bot_id: "laochen", bot_rating: 800, player_color: "red", moves: ["h2e2", "h7e7", "h0g2", "h9g7"], result: "loss", reason: "resign", helps: 0, started_at: "2026-10-09T10:00:00Z", ended_at: "2026-10-09T10:05:00Z" });
  const rating = (r: number, before = 800) => JSON.stringify({ rating: r, rd: 180, before, last_played: "2026-10-09T10:05:00Z" });
  const attempt = (client_id: string, puzzle_id = "p9") => JSON.stringify({ client_id, puzzle_id, score: 1, moves: ["a0a1"], at: "2026-10-09T11:00:00Z" });

  /** Runs `fn` with the service key's role (as the server functions do), then rolls back. */
  async function asServer<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    let out!: T;
    await db
      .transaction(async (tx) => {
        await tx.exec(`set local role service_role`);
        out = await fn(tx);
        await tx.rollback();
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error && /rollback/i.test(e.message))) throw e;
      });
    return out;
  }
  const errorOf = async (p: Promise<unknown>) => p.then(() => "no error", (e: Error) => e.message);

  beforeAll(() => signUp(D, { username: "dora_xq" }));

  it("only the server functions can record results", async () => {
    expect(await failsAs(D, `select public.record_bot_game('${D}', '${game()}', null, 0)`)).toMatch(/permission denied/);
    expect(await failsAs(D, `select public.record_puzzle_attempt('${D}', '${attempt("22222222-2222-4222-8222-222222222222")}', null, 0)`)).toMatch(/permission denied/);
    expect(await failsAs(D, `select public.save_rating('${D}', 'bot', '${rating(900)}', 0)`)).toMatch(/permission denied/);
  });

  it("saves a rated game with its rating, once, and refuses a rating that is out of date", async () => {
    const out = await asServer(async (tx) => {
      const first = (await tx.query<{ ok: boolean }>(`select public.record_bot_game($1, $2, $3, 0) as ok`, [D, game(), rating(780)])).rows[0]!.ok;
      const withAccuracy = JSON.stringify({ ...JSON.parse(game()), accuracy: 71.5 });
      const again = (await tx.query<{ ok: boolean }>(`select public.record_bot_game($1, $2, $3, 0) as ok`, [D, withAccuracy, rating(780)])).rows[0]!.ok;
      const r = (await tx.query(`select rating, games, last_played from public.ratings where user_id = $1 and kind = 'bot'`, [D])).rows;
      const g = (await tx.query(`select rated, rating_before, rating_after, moves, accuracy from public.bot_games where id = $1`, [GAME])).rows;
      // A second game computed from the same old rating (another tab got there first).
      const stale = await errorOf(tx.query(`select public.record_bot_game($1, $2, $3, 0)`, [D, game("33333333-3333-4333-8333-333333333333"), rating(760)]));
      return { first, again, r, g, stale };
    });
    expect(out).toEqual({
      first: true,
      again: false,
      r: [{ rating: 780, games: 1, last_played: new Date("2026-10-09T10:05:00Z") }],
      // Sent again with the accuracy from the review: saved once, accuracy filled in.
      g: [{ rated: true, rating_before: 800, rating_after: 780, moves: ["h2e2", "h7e7", "h0g2", "h9g7"], accuracy: 71.5 }],
      stale: "stale",
    });
  });

  it("a casual game leaves the rating alone; a JSON null counts as no rating", async () => {
    const out = await asServer(async (tx) => {
      await tx.query(`select public.record_bot_game($1, $2, 'null'::jsonb, 0)`, [D, game()]);
      return {
        g: (await tx.query(`select rated, rating_after from public.bot_games where id = $1`, [GAME])).rows,
        r: (await tx.query(`select 1 from public.ratings where user_id = $1`, [D])).rows,
      };
    });
    expect(out).toEqual({ g: [{ rated: false, rating_after: null }], r: [] });
  });

  it("rates a puzzle only the first time it is tried, and saves each attempt once", async () => {
    const out = await asServer(async (tx) => {
      const ok = (q: Promise<{ rows: { ok: boolean }[] }>) => q.then((r) => r.rows[0]!.ok);
      const first = await ok(tx.query(`select public.record_puzzle_attempt($1, $2, $3, 0) as ok`, [D, attempt("44444444-4444-4444-8444-444444444444"), rating(830)]));
      const retry = await ok(tx.query(`select public.record_puzzle_attempt($1, $2, $3, 0) as ok`, [D, attempt("44444444-4444-4444-8444-444444444444"), rating(830)]));
      // Each server call is its own transaction; here a savepoint stands in for that.
      await tx.exec(`savepoint repeat`);
      const ratedRepeat = await errorOf(tx.query(`select public.record_puzzle_attempt($1, $2, $3, 1)`, [D, attempt("55555555-5555-4555-8555-555555555555"), rating(850, 830)]));
      await tx.exec(`rollback to savepoint repeat`);
      const unratedRepeat = await ok(tx.query(`select public.record_puzzle_attempt($1, $2, null, 1) as ok`, [D, attempt("55555555-5555-4555-8555-555555555555")]));
      return {
        first,
        retry,
        ratedRepeat,
        unratedRepeat,
        attempts: (await tx.query(`select puzzle_id, rated, rating_after, moves from public.puzzle_attempts where user_id = $1 order by id`, [D])).rows,
        rating: (await tx.query(`select rating, games from public.ratings where user_id = $1 and kind = 'puzzle'`, [D])).rows,
      };
    });
    expect(out).toEqual({
      first: true,
      retry: false,
      ratedRepeat: "stale",
      unratedRepeat: true,
      attempts: [
        { puzzle_id: "p9", rated: true, rating_after: 830, moves: ["a0a1"] },
        { puzzle_id: "p9", rated: false, rating_after: null, moves: ["a0a1"] },
      ],
      rating: [{ rating: 830, games: 1 }],
    });
  });

  it("sets the starting rating once, before any rated result, from the four answers", async () => {
    const out = await as(D, async (tx) => {
      const bad = await errorOf(tx.query(`select public.set_starting_rating(1000)`));
      return { bad };
    });
    expect(out.bad).toMatch(/bad starting rating/);
    const set = await as(D, async (tx) => {
      const first = (await tx.query<{ ok: boolean }>(`select public.set_starting_rating(1200) as ok`)).rows[0]!.ok;
      const second = (await tx.query<{ ok: boolean }>(`select public.set_starting_rating(400) as ok`)).rows[0]!.ok;
      const rows = (await tx.query(`select kind, rating, rd, games from public.ratings order by kind`)).rows;
      return { first, second, rows };
    });
    expect(set).toEqual({
      first: true,
      second: false,
      rows: [
        { kind: "bot", rating: 1200, rd: 200, games: 0 },
        { kind: "puzzle", rating: 1200, rd: 200, games: 0 },
      ],
    });
    // Alice already has a bot rating: too late.
    expect(await as(A, async (tx) => (await tx.query<{ ok: boolean }>(`select public.set_starting_rating(1600) as ok`)).rows[0]!.ok)).toBe(false);
    expect(await failsAs(null, `select public.set_starting_rating(800)`)).toMatch(/permission denied/);
  });
});
