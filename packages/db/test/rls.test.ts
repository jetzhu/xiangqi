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
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz default now(), created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  -- Supabase Queues (pgmq), as far as the migrations use it: one queue, read in order.
  create schema pgmq;
  create table pgmq.q (msg_id bigserial primary key, message jsonb not null, archived boolean not null default false);
  create function pgmq.create(name text) returns void language sql as $$ select $$;
  create function pgmq.send(name text, msg jsonb) returns setof bigint language sql as
    $$ insert into pgmq.q (message) values (msg) returning msg_id $$;
  create function pgmq.read(name text, vt int, qty int) returns table (msg_id bigint, message jsonb) language sql as
    $$ select msg_id, message from pgmq.q where not archived order by msg_id limit qty $$;
  create function pgmq.archive(name text, id bigint) returns boolean language sql as
    $$ update pgmq.q set archived = true where msg_id = id returning true $$;
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

describe("deleting an account (M14)", () => {
  const E = "00000000-0000-4000-8000-00000000000e";
  const F = "00000000-0000-4000-8000-00000000000f";
  /** As `as`, with the token's sign-in time `minutesAgo` minutes back. */
  const signedInAs = <T>(user: string, minutesAgo: number, fn: (tx: Transaction) => Promise<T>) =>
    as(user, async (tx) => {
      const amr = [{ method: "password", timestamp: Math.floor(Date.now() / 1000) - minutesAgo * 60 }];
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, amr })]);
      return fn(tx);
    });
  const errorOf = async (p: Promise<unknown>) => p.then(() => "no error", (e: Error) => e.message);

  beforeAll(async () => {
    await signUp(E, { username: "erin_xq" });
    await signUp(F, {}); // a Google/Microsoft/GitHub sign-up: placeholder name, not chosen yet
  });

  it("needs a sign-in in the last 10 minutes and the username typed out", async () => {
    expect(await signedInAs(E, 30, (tx) => errorOf(tx.query(`select public.request_account_deletion('erin_xq')`)))).toMatch(/sign in again/);
    expect(await signedInAs(E, 2, (tx) => errorOf(tx.query(`select public.request_account_deletion('erin')`)))).toMatch(/username does not match/);
    const when = await signedInAs(E, 2, async (tx) => (await tx.query<{ at: Date }>(`select public.request_account_deletion('ERIN_XQ') as at`)).rows[0]!.at);
    expect(when.getTime() - Date.now()).toBeGreaterThan(9.9 * 864e5);
    expect(when.getTime() - Date.now()).toBeLessThan(10.1 * 864e5);
  });

  it("is cancelled by signing in again", async () => {
    const out = await signedInAs(E, 1, async (tx) => {
      await tx.query(`select public.request_account_deletion('erin_xq')`);
      const mine = (await tx.query(`select 1 from public.account_deletions`)).rows.length;
      const first = (await tx.query<{ ok: boolean }>(`select public.cancel_account_deletion() as ok`)).rows[0]!.ok;
      const second = (await tx.query<{ ok: boolean }>(`select public.cancel_account_deletion() as ok`)).rows[0]!.ok;
      return { mine, first, second };
    });
    expect(out).toEqual({ mine: 1, first: true, second: false });
  });

  it("deletes an account once its 10 days are up, and not before", async () => {
    await db.query(`insert into public.account_deletions (user_id, requested_at) values ($1, now() - interval '11 days'), ($2, now() - interval '9 days')`, [E, A]);
    expect(await failsAs(E, `select public.purge_deleted_accounts()`)).toMatch(/permission denied/);
    const { rows } = await db.query<{ n: number }>(`select public.purge_deleted_accounts() as n`);
    expect(rows[0]!.n).toBe(1);
    expect((await db.query(`select 1 from auth.users where id = $1`, [E])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.profiles where user_id = $1`, [E])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from auth.users where id = $1`, [A])).rows).toHaveLength(1);
    await db.query(`delete from public.account_deletions where user_id = $1`, [A]);
  });

  it("removes a brand-new provider account at once when its owner is under age", async () => {
    // Alice chose her name long ago: not removable this way.
    expect(await as(A, async (tx) => (await tx.query<{ ok: boolean }>(`select public.delete_new_account() as ok`)).rows[0]!.ok)).toBe(false);
    const { rows } = await db.query<{ ok: boolean }>(
      `select set_config('request.jwt.claim.sub', $1, false), public.delete_new_account() as ok`,
      [F],
    );
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    expect(rows[0]!.ok).toBe(true);
    expect((await db.query(`select 1 from auth.users where id = $1`, [F])).rows).toHaveLength(0);
  });
});

describe("online play groundwork (M15)", () => {
  const E = "00000000-0000-4000-8000-0000000000e1";
  const F = "00000000-0000-4000-8000-0000000000f1";
  const json = async <T>(user: string | null, sql: string): Promise<T> => as(user, async (tx) => (await tx.query<{ j: T }>(`select ${sql} as j`)).rows[0]!.j);

  beforeAll(async () => {
    await signUp(E, { username: "erin_xq" });
    await signUp(F, { username: "fang_xq" });
    await db.query(`update public.profiles set avatar = 'red-horse', country = 'CN' where user_id = $1`, [E]);
    await db.query(`insert into public.ratings (user_id, kind, rating, rd, games) values ($1, 'blitz', 1234.4, 80, 31), ($1, 'bot', 1000, 60, 20)`, [E]);
    await db.query(`insert into public.bot_ladder (id, rating) values ('laochen', 800), ('meiling', 1000), ('longwang', 2000)`);
  });

  it("keeps one rating per online speed", async () => {
    expect(await errorOfQuery(`insert into public.ratings (user_id, kind, rating, rd) values ('${E}', 'online', 800, 200)`)).toMatch(/ratings_kind_check/);
    expect(await errorOfQuery(`insert into public.ratings (user_id, kind, rating, rd) values ('${E}', 'rapid', 800, 200)`)).toBe("no error");
    await db.query(`delete from public.ratings where user_id = $1 and kind = 'rapid'`, [E]);
  });

  it("shows anyone a public profile, minimal until the player's birth month says they're 16 or older", async () => {
    const before = await json<Record<string, unknown>>(null, `public.public_profile('ERIN_XQ')`);
    expect(before).toMatchObject({ username: "erin_xq", minimal: true, avatar: null, country: null, member_since: null, ratings: { blitz: { rating: 1234, rd: 80, games: 31 } } });
    expect(before.ratings).not.toHaveProperty("bot");
    await as(E, async (tx) => {
      await tx.exec(`select public.set_birth_month(1990, 5)`);
      expect((await tx.query(`select birth_month from public.profiles`)).rows).toEqual([{ birth_month: new Date("1990-05-01T00:00:00Z") }]);
      expect((await tx.query<{ j: Record<string, unknown> }>(`select public.public_profile('erin_xq') as j`)).rows[0]!.j).toMatchObject({ minimal: false, avatar: "red-horse", country: "CN", me: true });
    });
    expect(await json(null, `public.public_profile('nobody_here')`)).toBeNull();
    expect(await failsAs(E, `update public.profiles set birth_month = '1990-01-01'`)).toMatch(/permission denied/);
    expect(await failsAs(E, `select public.set_birth_month(2010, 13)`)).toMatch(/bad birth month/);
    expect(await failsAs(E, `select public.set_birth_month(2999, 1)`)).toMatch(/bad birth month/);
    expect(await failsAs(null, `select public.set_birth_month(1990, 1)`)).toMatch(/permission denied/);
    expect(await failsAs(E, `select public.is_under16(p) from public.profiles p`)).toMatch(/permission denied/);
  });

  it("turns 16 on the first day of the month after the birth month, with nothing to run", async () => {
    const age = async (born: string) => {
      await db.query(`update public.profiles set birth_month = $2 where user_id = $1`, [E, born]);
      return json<{ under16: boolean; born: string; sixteen_on: string | null }>(E, `public.online_eligibility()`);
    };
    const month = (back: string) => db.query<{ d: string }>(`select to_char(date_trunc('month', now() - $1::interval), 'YYYY-MM-DD') as d`, [back]).then((r) => r.rows[0]!.d);
    // Born this month 16 years ago: the birthday may not have come yet, so still under 16.
    const thisMonth = await month("16 years");
    expect(await age(thisMonth)).toMatchObject({ under16: true, born: thisMonth.slice(0, 7), sixteen_on: expect.stringMatching(/-01$/) });
    expect(await age(await month("16 years 1 month"))).toMatchObject({ under16: false, sixteen_on: null });
    await db.query(`update public.profiles set birth_month = null where user_id = $1`, [E]);
  });

  it("changes the birth month: later at once, earlier once while under 16 and after a week", async () => {
    const state = () => json<Record<string, unknown>>(E, `public.online_eligibility()`);
    const set = (y: number, m: number) =>
      db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [E]);
        await tx.exec(`set local role authenticated`);
        await tx.exec(`select public.set_birth_month(${y}, ${m})`);
      });
    const year = new Date().getUTCFullYear();
    await set(year - 12, 6);
    expect(await state()).toMatchObject({ age_answered: true, under16: true, born: `${year - 12}-06`, born_next: null, earlier_used: false });
    // Later (younger): at once, any number of times.
    await set(year - 11, 6);
    expect(await state()).toMatchObject({ born: `${year - 11}-06`, born_next: null, earlier_used: false });
    // Earlier (older) while under 16: waits a week, and can be withdrawn, which gives the chance back.
    await set(1990, 1);
    expect(await state()).toMatchObject({ under16: true, born: `${year - 11}-06`, born_next: "1990-01", earlier_used: true });
    await set(year - 11, 6);
    expect(await state()).toMatchObject({ born: `${year - 11}-06`, born_next: null, earlier_used: false });
    // While it waits it can be changed again; once the week is up it counts, and there's no second time.
    await set(1990, 1);
    await set(1991, 2);
    expect(await state()).toMatchObject({ born_next: "1991-02" });
    await db.query(`update public.profiles set birth_month_next_at = now() - interval '1 second' where user_id = $1`, [E]);
    expect(await state()).toMatchObject({ under16: false, born: "1991-02", born_next: null, earlier_used: true });
    // Once 16: any change applies at once.
    await set(1985, 3);
    expect(await state()).toMatchObject({ under16: false, born: "1985-03", born_next: null });
    await set(year - 10, 1);
    expect(await state()).toMatchObject({ under16: true, born: `${year - 10}-01` });
    expect(await failsAs(E, `select public.set_birth_month(1990, 1)`)).toMatch(/already corrected/);
    await db.query(`update public.profiles set birth_month = null, birth_month_next = null, birth_month_next_at = null, birth_month_earlier_used = false where user_id = $1`, [E]);
  });

  it("blocks and unblocks by username, privately", async () => {
    const out = await as(E, async (tx) => {
      const q = async (sql: string) => (await tx.query<{ j: unknown }>(`select ${sql} as j`)).rows[0]!.j;
      const blocked = await q(`public.set_blocked('Fang_XQ', true)`);
      const self = await q(`public.set_blocked('erin_xq', true)`);
      const missing = await q(`public.set_blocked('nobody_here', true)`);
      const list = (await tx.query(`select username from public.my_blocks()`)).rows;
      const shown = ((await q(`public.public_profile('fang_xq')`)) as { blocked: boolean }).blocked;
      await q(`public.set_blocked('fang_xq', false)`);
      const after = (await tx.query(`select username from public.my_blocks()`)).rows;
      return { blocked, self, missing, list, shown, after };
    });
    expect(out).toEqual({ blocked: true, self: false, missing: false, list: [{ username: "fang_xq" }], shown: true, after: [] });
    expect(await failsAs(E, `select * from public.blocks`)).toMatch(/permission denied/);
    expect(await failsAs(null, `select public.set_blocked('fang_xq', true)`)).toMatch(/permission denied/);
  });

  it("opens online play after the age answer and a clean win at the player's level, or 3 long games", async () => {
    const check = () => json<Record<string, unknown>>(F, `public.online_eligibility()`);
    expect(await check()).toMatchObject({ verified: true, age_answered: false, level: 800, target: 800, clean_win: false, long_games: 0, eligible: false });
    await db.query(`update public.profiles set birth_month = date_trunc('month', now() - interval '10 years') where user_id = $1`, [F]);
    const game = (bot: string, rating: number, result: string, helps: number, plies: number) =>
      db.query(
        `insert into public.bot_games (user_id, bot_id, bot_rating, player_color, moves, result, helps, rated, started_at)
         values ($1, $2, $3, 'red', array_fill('h2e2'::text, array[$4::int]), $5, $6, true, now())`,
        [F, bot, rating, plies, result, helps],
      );
    // A win below their level, and a win at their level with a hint, don't count.
    await game("xiaobing", 250, "win", 0, 30);
    await game("laochen", 800, "win", 1, 30);
    expect(await check()).toMatchObject({ age_answered: true, under16: true, clean_win: false, long_games: 2, eligible: false });
    await game("afu", 400, "loss", 0, 20);
    expect(await check()).toMatchObject({ long_games: 3, eligible: true });
    await db.query(`delete from public.bot_games where user_id = $1`, [F]);
    await game("laochen", 800, "win", 0, 12);
    expect(await check()).toMatchObject({ clean_win: true, long_games: 0, eligible: true });
    // Above the ladder, a clean win over the strongest bot is enough.
    await db.query(`insert into public.ratings (user_id, kind, rating, rd) values ($1, 'bot', 2300, 60)`, [F]);
    expect(await check()).toMatchObject({ level: 2300, target: 2000, clean_win: false });
    await game("longwang", 2000, "win", 0, 80);
    expect(await check()).toMatchObject({ clean_win: true, eligible: true });
    // Unverified email: not yet.
    await db.query(`update auth.users set email_confirmed_at = null where id = $1`, [F]);
    expect(await check()).toMatchObject({ verified: false, eligible: false });
  });
});

describe("play a friend (M16)", () => {
  const G = "00000000-0000-4000-8000-0000000000a7";
  const H = "00000000-0000-4000-8000-0000000000b8";
  /** Runs as a user and keeps the changes. */
  const commitAs = async <T>(user: string, sql: string, params: unknown[] = []): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
      await tx.exec(`set local role authenticated`);
      return (await tx.query<{ j: T }>(`select ${sql} as j`, params)).rows[0]!.j;
    });
  const errorAs = (user: string | null, sql: string) => failsAs(user, `select ${sql}`);

  beforeAll(async () => {
    await signUp(G, { username: "gao_xq" });
    await signUp(H, { username: "hu_xq" });
    // Both ready for online play: 16 or older, and 3 bot games of 10 moves each.
    for (const u of [G, H]) {
      await db.query(`update public.profiles set birth_month = '1990-01-01' where user_id = $1`, [u]);
      await db.query(
        `insert into public.bot_games (user_id, bot_id, bot_rating, player_color, moves, result, helps, rated, started_at)
         select $1, 'laochen', 800, 'red', array_fill('h2e2'::text, array[30]), 'loss', 0, true, now() from generate_series(1, 3)`,
        [u],
      );
    }
    await db.query(`insert into public.ratings (user_id, kind, rating, rd, games) values ($1, 'bot', 1111, 70, 25)`, [G]);
  });

  let code = "";
  let game = "";

  it("creates a challenge link anyone can look at", async () => {
    code = await commitAs<string>(G, `public.create_challenge(300, 3, 'red', true, false)`);
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    const seen = await as(null, async (tx) => (await tx.query<{ j: Record<string, unknown> }>(`select public.challenge_info($1) as j`, [code.toLowerCase()])).rows[0]!.j);
    expect(seen).toMatchObject({ from: "gao_xq", mine: false, base: 300, inc: 3, color: "red", rated: true, expired: false, game: null, taken: false });
    // Not ready for online play: no challenges.
    expect(await errorAs(A, `public.create_challenge(300, 3, 'red', true, false)`)).toMatch(/not ready/);
    expect(await errorAs(G, `public.create_challenge(301, 3, 'red', true, false)`)).toMatch(/check constraint/);
  });

  it("keeps the challenger's own challenge to the challenger, and refuses blocked players", async () => {
    expect(await errorAs(G, `public.accept_challenge('${code}', false)`)).toMatch(/your own/);
    await db.query(`insert into public.blocks (user_id, blocked_id) values ($1, $2)`, [G, H]);
    expect(await errorAs(H, `public.accept_challenge('${code}', false)`)).toMatch(/blocked/);
    await db.query(`delete from public.blocks`);
  });

  it("starts the game on accepting, with ratings for both players at its speed", async () => {
    game = await commitAs<string>(H, `public.accept_challenge($1, false)`, [code]);
    expect(await errorAs(A, `public.accept_challenge('${code}', false)`)).toMatch(/not ready|already taken/);
    const info = await commitAs<Record<string, unknown>>(G, `public.game_info($1)`, [game]);
    expect(info).toMatchObject({ me: "red", speed: "blitz", rated: true, relay: false, status: "playing", red: { username: "gao_xq", rating: 1111 }, black: { username: "hu_xq", rating: 800 } });
    expect(await commitAs(H, `public.challenge_info($1)->>'game'`, [code])).toBe(game);
    // Someone else sees nothing of it.
    expect(await commitAs(A, `public.game_info($1)`, [game])).toBeNull();
    expect(await commitAs(A, `public.challenge_info($1)->>'game'`, [code])).toBeNull();
    expect(await as(A, async (tx) => (await tx.query(`select id from public.games`)).rows)).toEqual([]);
    expect(await as(H, async (tx) => (await tx.query(`select id from public.games`)).rows)).toEqual([{ id: game }]);
  });

  it("lets a new player play casual friend games; rated ones need the bot games from both", async () => {
    const K = "00000000-0000-4000-8000-0000000000c9";
    await signUp(K, { username: "kong_xq" });
    // No birth month yet: nothing.
    expect(await errorAs(K, `public.create_challenge(600, 5, 'red', false, false)`)).toMatch(/not ready/);
    await db.query(`update public.profiles set birth_month = '1990-01-01' where user_id = $1`, [K]);
    expect(await commitAs(K, `public.online_eligibility()`)).toMatchObject({ casual_ok: true, eligible: false });
    // Casual: make and accept. Rated: neither, unless accepted as casual.
    const casual = await commitAs<string>(K, `public.create_challenge(600, 5, 'red', false, false)`);
    expect(await errorAs(K, `public.create_challenge(600, 5, 'red', true, false)`)).toMatch(/not ready/);
    const g1 = await commitAs<string>(G, `public.accept_challenge($1, false)`, [casual]);
    expect(await commitAs(G, `public.game_info($1)->'rated'`, [g1])).toBe(false);
    const rated = await commitAs<string>(G, `public.create_challenge(600, 5, 'red', true, false)`);
    expect(await errorAs(K, `public.accept_challenge('${rated}', false)`)).toMatch(/not ready/);
    const g2 = await commitAs<string>(K, `public.accept_challenge($1, false, true)`, [rated]);
    expect(await commitAs(K, `public.game_info($1)->'rated'`, [g2])).toBe(false);
    // Unverified: not even casual.
    await db.query(`update auth.users set email_confirmed_at = null where id = $1`, [K]);
    expect(await errorAs(K, `public.create_challenge(600, 5, 'red', false, false)`)).toMatch(/not ready/);
  });

  it("relays the game when either player asks, or a player is under 16", async () => {
    const c2 = await commitAs<string>(G, `public.create_challenge(600, 5, 'random', false, false)`);
    const g2 = await commitAs<string>(H, `public.accept_challenge($1, true)`, [c2]);
    expect(await commitAs(G, `public.game_info($1)->'relay'`, [g2])).toBe(true);
    await db.query(`update public.profiles set birth_month = date_trunc('month', now() - interval '10 years') where user_id = $1`, [H]);
    const c3 = await commitAs<string>(G, `public.create_challenge(600, 5, 'black', false, false)`);
    const g3 = await commitAs<string>(H, `public.accept_challenge($1, false)`, [c3]);
    expect(await commitAs(H, `public.game_info($1)`, [g3])).toMatchObject({ relay: true, me: "red" });
    await db.query(`update public.profiles set birth_month = '1990-01-01' where user_id = $1`, [H]);
  });

  it("queues the players' reports and writes them to the game log, stamped on arrival", async () => {
    const move = (ply: number, iccs: string) => JSON.stringify({ kind: "move", ply, iccs, clocks: { red: 300000, black: 300000 }, hash: "x" });
    await commitAs(G, `public.report_game($1, $2)`, [game, move(1, "h2e2")]);
    await commitAs(H, `public.report_game($1, $2)`, [game, move(1, "h2e2")]);
    await commitAs(H, `public.report_game($1, $2)`, [game, JSON.stringify({ kind: "end", result: { winner: "red", reason: "resign" }, moves: ["h2e2", "h9g7"], clocks: {} })]);
    expect(await errorAs(A, `public.report_game('${game}', '{"kind":"move"}')`)).toMatch(/not your game/);
    expect(await errorAs(G, `public.report_game('${game}', '{"kind":"chat"}')`)).toMatch(/bad report/);
    expect(await errorAs(G, `public.process_game_reports()`)).toMatch(/permission denied/);
    const handled = (await db.query<{ n: number }>(`select public.process_game_reports() as n`)).rows[0]!.n;
    expect(handled).toBe(3);
    const log = (await db.query<{ by_color: string; kind: string; ply: number | null; at: string }>(`select by_color, kind, ply, at from public.game_log where game_id = $1 order by id`, [game])).rows;
    expect(log.map((l) => [l.by_color, l.kind, l.ply])).toEqual([["red", "move", 1], ["black", "move", 1], ["black", "end", null]]);
    expect(log.every((l) => l.at)).toBe(true);
    const ends = (await db.query(`select red_end, black_end from public.games where id = $1`, [game])).rows[0];
    expect(ends).toMatchObject({ red_end: null, black_end: { result: { winner: "red", reason: "resign" } } });
    expect(await failsAs(G, `select * from public.game_log`)).toMatch(/permission denied/);
  });

  it("saves the result and both ratings once, and only if the ratings haven't changed meanwhile", async () => {
    const games = async (u: string) => (await db.query<{ games: number }>(`select games from public.ratings where user_id = $1 and kind = 'blitz'`, [u])).rows[0]!.games;
    const [g0, h0] = [await games(G), await games(H)];
    const at = new Date().toISOString();
    const finish = (expected: object) =>
      db.query<{ ok: boolean }>(`select public.finish_game($1, 'red', 'resign', $2, $3, $4, $5) as ok`, [
        game,
        ["h2e2", "h9g7"],
        { before: 1111, rating: 1150, rd: 180, last_played: at },
        { before: 800, rating: 770, rd: 180, last_played: at },
        expected,
      ]);
    // A rating that changed since it was read: nothing is saved.
    await expect(finish({ red: g0 + 1, black: h0 })).rejects.toThrow(/stale/);
    expect((await db.query(`select status from public.games where id = $1`, [game])).rows[0]).toEqual({ status: "playing" });
    expect((await finish({ red: g0, black: h0 })).rows[0]!.ok).toBe(true);
    expect((await finish({ red: g0 + 1, black: h0 + 1 })).rows[0]!.ok).toBe(false);
    expect([await games(G), await games(H)]).toEqual([g0 + 1, h0 + 1]);
    expect(await commitAs(H, `public.game_info($1)`, [game])).toMatchObject({ status: "over", result: "red", reason: "resign", moves: ["h2e2", "h9g7"], red_rating_after: 1150, black_rating_after: 770 });
    expect(await failsAs(G, `select public.finish_game('${game}', 'red', 'resign', '{}', null, null, '{}')`)).toMatch(/permission denied/);
  });

  it("ends games nobody reports on for 10 minutes", async () => {
    const c = await commitAs<string>(G, `public.create_challenge(60, 0, 'red', true, false)`);
    const g = await commitAs<string>(H, `public.accept_challenge($1, false)`, [c]);
    await db.query(`update public.games set last_report_at = now() - interval '11 minutes' where id = $1`, [g]);
    await db.query(`select public.process_game_reports()`);
    expect((await db.query(`select status, result, reason from public.games where id = $1`, [g])).rows[0]).toEqual({ status: "over", result: "none", reason: "aborted" });
  });
});

describe("quick pairing (M17)", () => {
  const [P, Q, R, S] = ["d1", "d2", "d3", "d4"].map((x) => `00000000-0000-4000-8000-0000000000${x}`) as [string, string, string, string];
  const run = async <T>(user: string, sql: string, params: unknown[] = []): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
      await tx.exec(`set local role authenticated`);
      return (await tx.query<{ j: T }>(`select ${sql} as j`, params)).rows[0]!.j;
    });
  const errorOf = (user: string, sql: string) => failsAs(user, `select ${sql}`);
  const seek = (user: string, filters: object = {}, tile = "300, 3") => run(user, `public.seek(${tile}, $1, false)`, [JSON.stringify({ range: 200, established: false, account_age: 0, completion: 0, ...filters })]);
  type Found = { status: string; game?: string; window?: number; nearest?: { username: string; diff: number }[]; invite?: { id: number; diff: number } | null; counts?: Record<string, number> };
  const find = (user: string) => run<Found>(user, `public.find_match()`);
  const rate = (user: string, rating: number, games = 20) =>
    db.query(`insert into public.ratings (user_id, kind, rating, rd, games) values ($1, 'blitz', $2, 80, $3)
              on conflict (user_id, kind) do update set rating = excluded.rating, games = excluded.games`, [user, rating, games]);
  const reset = () => db.exec(`delete from public.seeks; delete from public.seek_invites; delete from public.blocks;`);

  beforeAll(async () => {
    for (const [u, name] of [[P, "pan_xq"], [Q, "qin_xq"], [R, "ren_xq"], [S, "shi_xq"]] as const) {
      await signUp(u, { username: name });
      await db.query(`update public.profiles set birth_month = '1990-01-01' where user_id = $1`, [u]);
      await db.query(
        `insert into public.bot_games (user_id, bot_id, bot_rating, player_color, moves, result, helps, rated, started_at)
         select $1, 'laochen', 800, 'red', array_fill('h2e2'::text, array[30]), 'loss', 0, true, now() from generate_series(1, 3)`,
        [u],
      );
    }
  });

  it("seeks only on a tile, once ready for rated play", async () => {
    expect(await errorOf(P, `public.seek(300, 2, '{}', false)`)).toMatch(/not a tile/);
    expect(await errorOf(P, `public.seek(300, 3, '{"range": 150}', false)`)).toMatch(/bad filters/);
    expect(await errorOf(A, `public.seek(300, 3, '{}', false)`)).toMatch(/not ready/);
    expect(await failsAs(null, `select public.find_match()`)).toMatch(/permission denied/);
    expect(await find(P)).toEqual({ status: "idle" });
  });

  it("pairs the nearest rating inside both windows, in one step", async () => {
    await reset();
    await rate(P, 1200);
    await rate(Q, 1230);
    await rate(R, 1500);
    await seek(R);
    await seek(P);
    expect(await find(P)).toMatchObject({ status: "searching", window: 50, counts: { "300+3": 2 } });
    await seek(Q);
    const q = await find(Q);
    expect(q).toMatchObject({ status: "matched" });
    expect(await find(P)).toEqual({ status: "matched", game: q.game });
    expect(await find(P)).toEqual({ status: "idle" });
    expect(await run(P, `public.game_info($1)`, [q.game])).toMatchObject({ rated: true, speed: "blitz", base: 300, inc: 3, status: "playing" });
  });

  it("widens the window with waiting, and lists the nearest players outside it", async () => {
    await reset();
    await rate(P, 1200);
    await rate(R, 1390);
    await seek(P);
    await seek(R);
    const p = await find(P);
    expect(p).toMatchObject({ status: "searching", window: 50, nearest: [{ username: "ren_xq", rating: 1390, diff: 190 }] });
    // 30 s later: ±200, so they're paired.
    await db.query(`update public.seeks set created_at = now() - interval '30 seconds'`);
    expect(await find(P)).toMatchObject({ status: "matched" });
  });

  it("plays anyway when both accept, and widens to anyone within the filter", async () => {
    await reset();
    await rate(P, 1200);
    await rate(R, 1500);
    await seek(P);
    await seek(R);
    expect(await run(P, `public.invite_seeker('REN_XQ')`)).toBe(true);
    expect((await find(P)).nearest).toMatchObject([{ username: "ren_xq", invited: true }]);
    const r = await find(R);
    expect(r.invite).toMatchObject({ diff: -300 });
    expect(await run(S, `public.answer_invite($1, true)`, [r.invite!.id])).toBeNull(); // not theirs
    const game = await run<string>(R, `public.answer_invite($1, true)`, [r.invite!.id]);
    expect(await find(P)).toEqual({ status: "matched", game });
    // "Anyone" still keeps the player's own range filter.
    await reset();
    await seek(P, { range: 300 });
    await seek(R);
    await run(P, `public.widen_seek()`);
    await run(R, `public.widen_seek()`);
    expect(await find(P)).toMatchObject({ status: "searching", window: 300 });
    await seek(R, { range: null });
    await run(R, `public.widen_seek()`);
    await seek(P, { range: null });
    await run(P, `public.widen_seek()`);
    expect(await find(P)).toMatchObject({ status: "matched" });
  });

  it("applies filters both ways, blocks, and only live seeks", async () => {
    await reset();
    await rate(P, 1200);
    await rate(Q, 1210, 3);
    await seek(P, { established: true });
    await seek(Q);
    expect(await find(P)).toMatchObject({ status: "searching", nearest: [] });
    await seek(P);
    await db.query(`insert into public.blocks (user_id, blocked_id) values ($1, $2)`, [Q, P]);
    expect(await find(P)).toMatchObject({ status: "searching", nearest: [] });
    await db.query(`delete from public.blocks`);
    await db.query(`update public.seeks set seen_at = now() - interval '20 seconds' where user_id = $1`, [Q]);
    expect(await find(P)).toMatchObject({ status: "searching", counts: { "300+3": 1 } });
    await run(Q, `public.find_match()`);
    expect(await find(P)).toMatchObject({ status: "matched" });
    await db.query(`update public.seeks set seen_at = now() - interval '2 minutes'`);
    await db.query(`select public.clear_seeks()`);
    expect((await db.query(`select count(*)::int as n from public.seeks`)).rows[0]).toEqual({ n: 0 });
  });

  it("keeps a sportsmanship record: a warning, then pairing waits, and the completion rate", async () => {
    await reset();
    const game = (user: string, opp: string, labels: object, endedAgo = "1 hour") =>
      db.query(
        `insert into public.games (red, black, base, inc, speed, rated, relay, status, result, reason, labels, started_at, ended_at)
         values ($1, $2, 300, 3, 'blitz', true, false, 'over', 'black', 'abandoned', $3, now() - $4::interval, now() - $4::interval)`,
        [user, opp, JSON.stringify(labels), endedAgo],
      );
    for (let i = 0; i < 4; i++) await game(S, R, {}, "2 days");
    expect(await run(S, `public.my_sportsmanship()`)).toMatchObject({ completion: null, warning: false, wait_until: null, pool: false });
    await game(S, R, { red: ["abandoned"] });
    expect(await run(S, `public.my_sportsmanship()`)).toMatchObject({ completion: 80, warning: true, last30: { games: 5, abandoned: 1 } });
    expect(await errorOf(S, `public.seek(300, 3, '{}', false)`)).toMatch(/sportsmanship/);
    expect(await as(null, async (tx) => (await tx.query<{ j: unknown }>(`select public.public_profile('shi_xq') as j`)).rows[0]!.j)).toMatchObject({ completion: 80 });
    await run(S, `public.acknowledge_sportsmanship()`);
    expect(await run(S, `public.my_sportsmanship()`)).toMatchObject({ warning: false, wait_until: null, pool: false });
    await seek(S);
    // Another within 3 days: a 10-minute wait, then matched with others who do the same.
    await game(S, R, { red: ["stalled"] }, "0 seconds");
    const sport = await run<{ wait_until: string; pool: boolean }>(S, `public.my_sportsmanship()`);
    expect(Date.parse(sport.wait_until) - Date.now()).toBeGreaterThan(8 * 60_000);
    expect(sport.pool).toBe(true);
    expect(await errorOf(S, `public.seek(300, 3, '{}', false)`)).toMatch(/sportsmanship/);
    // 20 minutes on, the wait is over; the pool stays for 3 days.
    await db.query(`update public.profiles set sport_warned_at = sport_warned_at - interval '20 minutes' where user_id = $1`, [S]);
    await db.query(`update public.games set ended_at = ended_at - interval '20 minutes' where red = $1 and labels ? 'red'`, [S]);
    expect(await run(S, `public.my_sportsmanship()`)).toMatchObject({ wait_until: null, pool: true });
  });

  it("gives Red to whoever had Black more often", async () => {
    await reset();
    await db.query(`delete from public.games where $1 in (red, black) or $2 in (red, black)`, [P, Q]);
    await rate(P, 1200);
    await rate(Q, 1200);
    await db.query(`insert into public.games (red, black, base, inc, speed, rated, relay) values ($1, $2, 300, 3, 'blitz', true, false)`, [P, Q]);
    await seek(P);
    await seek(Q);
    const game = (await find(Q)).game!;
    expect(await run(Q, `public.game_info($1)->>'me'`, [game])).toBe("red");
  });
});

describe("fair play (M18)", () => {
  const [T, U, V] = ["e7", "e8", "e9"].map((x) => `00000000-0000-4000-8000-0000000000${x}`) as [string, string, string];
  const q = <T>(sql: string, params: unknown[] = []) => db.query<{ j: T }>(`select ${sql} as j`, params).then((r) => r.rows[0]!.j);
  const side = (z: number, flags: string[] = [], acc = 70, match = 0.4) => ({ moves: 30, acc, match, z, flags, timing: {} });
  /** A finished rated game between two players, already checked, `plies` long. */
  const checked = (red: string, black: string, sides: { red: object; black: object }, opts: { plies?: number; result?: string; ago?: string } = {}) =>
    q<string>(
      `public.insert_test_game($1, $2, $3, $4, $5, $6)`,
      [red, black, opts.plies ?? 60, opts.result ?? "draw", JSON.stringify({ status: "checked", ...sides }), opts.ago ?? "1 hour"],
    );

  beforeAll(async () => {
    for (const [u, name] of [[T, "tang_xq"], [U, "ulan_xq"], [V, "vic_xq"]] as const) {
      await signUp(u, { username: name });
      await db.query(`update public.profiles set birth_month = '1990-01-01' where user_id = $1`, [u]);
      await db.query(
        `insert into public.bot_games (user_id, bot_id, bot_rating, player_color, moves, result, helps, rated, started_at)
         select $1, 'laochen', 800, 'red', array_fill('h2e2'::text, array[30]), 'loss', 0, true, now() from generate_series(1, 3)`,
        [u],
      );
    }
    await db.exec(`
      create function public.insert_test_game(p_red uuid, p_black uuid, p_plies int, p_result text, p_fp jsonb, p_ago interval)
      returns uuid language sql as $$
        insert into public.games (red, black, base, inc, speed, rated, relay, status, result, reason, moves, red_rating_before, black_rating_before, fairplay, started_at, ended_at)
        values (p_red, p_black, 300, 3, 'blitz', true, false, 'over', p_result, 'resign', array_fill('h2e2'::text, array[p_plies]), 1200, 1200, p_fp, now() - p_ago, now() - p_ago)
        returning id
      $$;`);
  });

  it("keeps both browsers' analyses, for the server only", async () => {
    const g = await checked(T, U, { red: side(0), black: side(0) });
    expect(await q(`public.save_analysis($1, 'red', '{"v": 1}')`, [g])).toEqual({ red: { v: 1 } });
    expect(await q(`public.save_analysis($1, 'black', '{"v": 2}')`, [g])).toEqual({ red: { v: 1 }, black: { v: 2 } });
    expect(await failsAs(T, `select public.save_analysis('${g}', 'red', '{}')`)).toMatch(/permission denied/);
    expect(await failsAs(T, `select * from public.game_analysis`)).toMatch(/permission denied/);
    expect(await failsAs(T, `select * from public.fairplay`)).toMatch(/permission denied/);
    expect(await failsAs(T, `select * from public.fairplay_config`)).toMatch(/permission denied/);
  });

  it("starts baselines from an estimate and moves them towards the site's own games", async () => {
    const prior = await q<{ acc: { mean: number }; match: { mean: number }; games: number }>(`public.fairplay_baseline('rapid', 1200)`);
    expect(prior).toMatchObject({ acc: { mean: 60, sd: 10 }, match: { mean: 0.318 }, games: 0 });
    for (let i = 0; i < 30; i++) await db.query(`select public.insert_test_game($1, $2, 60, 'draw', $3, '1 day')`, [U, V, JSON.stringify({ status: "checked", red: side(0, [], 80, 0.5), black: side(0, [], 80, 0.5) })]);
    const b = await q<{ acc: { mean: number }; games: number }>(`public.fairplay_baseline('blitz', 1200)`);
    expect(b.games).toBeGreaterThanOrEqual(60);
    expect(b.acc.mean).toBeGreaterThan(70);
    expect(b.acc.mean).toBeLessThan(80);
  });

  it("judges a player from many games: likely only with enough games far out of line", async () => {
    await db.query(`delete from public.games where $1 in (red, black)`, [T]);
    for (let i = 0; i < 9; i++) await checked(T, V, { red: side(3), black: side(0) });
    await q(`public.save_fairplay($1, '{"status": "checked", "red": {"z": 3, "flags": []}, "black": {"z": 0, "flags": []}}')`, [await checked(T, V, { red: side(3), black: side(0) })]);
    const standing = async (u: string) => (await db.query(`select games, score, far, verdict from public.fairplay where user_id = $1 and speed = 'blitz'`, [u])).rows[0];
    expect(await standing(T)).toMatchObject({ games: 10, verdict: "likely" });
    // Ten games 3 standard deviations out: 3 × 10 / √10.
    expect(Number(((await standing(T)) as { score: string }).score)).toBeCloseTo(9.49, 1);
    expect(await standing(V)).toMatchObject({ verdict: "normal" });
    // A short game isn't scored, and a first analysis doesn't undo a check.
    const short = await checked(T, V, { red: side(9), black: side(0) }, { plies: 20 });
    await q(`public.save_fairplay($1, '{"status": "one"}')`, [short]);
    expect(await q(`(select fairplay->>'status' from public.games where id = $1)`, [short])).toBe("checked");
    // Checked games on the profile: long enough, and not far out of line.
    expect(await q(`public.public_profile('vic_xq')->'checked_games'`)).toBeGreaterThanOrEqual(10);
    expect(await q(`public.public_profile('tang_xq')->'checked_games'`)).toBe(0);
  });

  it("matches a likely player only with others in the same position, and applies the checked filter", async () => {
    await db.exec(`delete from public.seeks;`);
    for (const u of [T, U, V]) await db.query(`insert into public.ratings (user_id, kind, rating, rd, games) values ($1, 'blitz', 1200, 80, 20) on conflict (user_id, kind) do update set rating = 1200`, [u]);
    const run = <R>(user: string, sql: string) =>
      db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
        await tx.exec(`set local role authenticated`);
        return (await tx.query<{ j: R }>(`select ${sql} as j`)).rows[0]!.j;
      });
    const filters = (checked: boolean) => `'${JSON.stringify({ range: 200, established: false, account_age: 0, completion: 0, checked })}'`;
    await run(T, `public.seek(300, 3, ${filters(false)}, false)`);
    await run(U, `public.seek(300, 3, ${filters(false)}, false)`);
    expect(await run(U, `public.find_match()->>'status'`)).toBe("searching");
    await run(T, `public.cancel_seek()`);
    // U asks for checked opponents: V has them, and no finding.
    await run(U, `public.seek(300, 3, ${filters(true)}, false)`);
    await run(V, `public.seek(300, 3, ${filters(false)}, false)`);
    expect(await run(V, `public.find_match()->>'status'`)).toBe("matched");
    await db.exec(`delete from public.seeks;`);
  });

  it("sends unchecked games of strong players to the moderators after a day", async () => {
    const g = await q<string>(`public.insert_test_game($1, $2, 60, 'draw', null, '2 days')`, [T, U]);
    await db.query(`update public.games set red_rating_before = 1900 where id = $1`, [g]);
    await db.query(`select public.mark_unchecked_games()`);
    expect(await q(`(select fairplay->>'status' from public.games where id = $1)`, [g])).toBe("missing");
  });
});

async function errorOfQuery(sql: string): Promise<string> {
  return db.query(sql).then(() => "no error", (e: Error) => e.message);
}
