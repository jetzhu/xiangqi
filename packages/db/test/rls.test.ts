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
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{"aal": "aal2"}')::jsonb $$;
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
  create function pgmq.delete(name text, ids bigint[]) returns setof bigint language sql as
    $$ delete from pgmq.q where msg_id = any(ids) returning msg_id $$;
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

  it("works through a big queue in batches, deletes what it processed, and packs old logs", async () => {
    const c = await commitAs<string>(G, `public.create_challenge(600, 5, 'red', false, false)`);
    const g = await commitAs<string>(H, `public.accept_challenge($1, false)`, [c]);
    for (let ply = 1; ply <= 30; ply++)
      await db.query(`select pgmq.send('game_reports', jsonb_build_object('game', $1::uuid, 'by', 'red', 'at', now(), 'report', jsonb_build_object('kind', 'move', 'ply', $2::int)))`, [g, ply]);
    // Batches of 7: the run goes on until the queue is empty.
    expect((await db.query<{ n: number }>(`select public.process_game_reports(7) as n`)).rows[0]!.n).toBe(30);
    expect((await db.query(`select count(*)::int as n from pgmq.q`)).rows).toEqual([{ n: 0 }]);
    expect((await db.query(`select count(*)::int as n from public.game_log where game_id = $1`, [g])).rows).toEqual([{ n: 30 }]);
    // Over for more than 8 days: the log becomes one value on the game.
    await db.query(`update public.games set status = 'over', ended_at = now() - interval '9 days' where id = $1`, [g]);
    await db.query(`select public.pack_game_logs()`);
    expect((await db.query(`select count(*)::int as n from public.game_log where game_id = $1`, [g])).rows).toEqual([{ n: 0 }]);
    const packed = (await db.query<{ p: { ply: number; by: string }[] }>(`select log_packed as p from public.games where id = $1`, [g])).rows[0]!.p;
    expect(packed).toHaveLength(30);
    expect(packed[29]).toMatchObject({ ply: 30, by: "red" });
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
  type Found = {
    status: string;
    game?: string;
    window?: number;
    nearest?: { username: string; diff: number }[];
    invite?: { id: number; diff: number } | null;
    counts?: Record<string, number>;
    excluded?: Record<string, number>;
  };
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

  it("doesn't let a new search wipe out a match just made", async () => {
    await reset();
    await rate(P, 1200);
    await rate(Q, 1210);
    await seek(P);
    await seek(Q);
    const game = (await find(Q)).game;
    expect(game).toBeTruthy();
    // P clicks a tile again before their page has heard about the match.
    await seek(P);
    expect(await find(P)).toEqual({ status: "matched", game });
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
    // P is told their own filter is why: one player left out as not yet established. Q isn't told about P's filter.
    expect(await find(P)).toMatchObject({ status: "searching", nearest: [], excluded: { established: 1 } });
    expect(await find(Q)).toMatchObject({ status: "searching", excluded: {} });
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
    // Counted from the first game, from a clean record worth 5 finished games.
    expect(await run(S, `public.my_sportsmanship()`)).toMatchObject({ completion: 100, warning: false, wait_until: null, pool: false });
    await game(S, R, { red: ["abandoned"] });
    expect(await run(S, `public.my_sportsmanship()`)).toMatchObject({ completion: 90, warning: true, last30: { games: 5, abandoned: 1 } });
    expect(await errorOf(S, `public.seek(300, 3, '{}', false)`)).toMatch(/sportsmanship/);
    expect(await as(null, async (tx) => (await tx.query<{ j: unknown }>(`select public.public_profile('shi_xq') as j`)).rows[0]!.j)).toMatchObject({ completion: 90 });
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

  it("catches a throwaway account's aborts from its first games, and lets moderators excuse a mark or reset the record", async () => {
    const T = "00000000-0000-4000-8000-0000000000d9";
    await signUp(T, { username: "throw_xq" });
    const MODU = "00000000-0000-4000-8000-0000000000da";
    await signUp(MODU, { username: "sportmod_xq" });
    await db.query(`insert into public.moderators (user_id) values ($1)`, [MODU]);
    const aborted = async () =>
      (
        await db.query<{ id: string }>(
          `insert into public.games (red, black, base, inc, speed, rated, relay, status, result, reason, labels, started_at, ended_at)
           values ($1, $2, 300, 3, 'blitz', true, false, 'over', 'none', 'aborted', '{"red": ["aborted"]}', now() - interval '1 hour', now() - interval '1 hour') returning id`,
          [T, R],
        )
      ).rows[0]!.id;
    const completion = async () => (await db.query<{ c: number }>(`select public.completion_of($1) as c`, [T])).rows[0]!.c;
    expect(await completion()).toBeNull();
    const first = await aborted();
    await aborted();
    await aborted();
    expect(await completion()).toBe(63); // (0 + 5) / (3 + 5): a 90 % filter leaves it out at once
    // Excusing one mark (logged), then resetting the record.
    expect(await failsAs(T, `select public.mod_excuse_label('${first}', 'throw_xq', 'aborted', 'x')`)).toMatch(/moderators only/);
    await run(MODU, `public.mod_excuse_label($1, 'throw_xq', 'aborted', 'site fault in that game')`, [first]);
    expect(await completion()).toBe(75); // (1 + 5) / (3 + 5)
    expect(await failsAs(MODU, `select public.mod_excuse_label('${first}', 'throw_xq', 'aborted', 'again')`)).toMatch(/no such mark/);
    await run(MODU, `public.mod_reset_sportsmanship('throw_xq', 'test games')`);
    expect(await completion()).toBeNull();
    expect(await run(MODU, `public.mod_log_recent()`)).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "excuse-mark", target: "throw_xq" }), expect.objectContaining({ action: "reset-sportsmanship", target: "throw_xq" })]),
    );
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

describe("reports and moderation (M19)", () => {
  const [MOD, X, Y, Z] = ["b1", "b2", "b3", "b4"].map((x) => `00000000-0000-4000-8000-0000000000${x}`) as [string, string, string, string];
  const run = <R>(user: string, sql: string, params: unknown[] = []) =>
    db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
      await tx.exec(`set local role authenticated`);
      return (await tx.query<{ j: R }>(`select ${sql} as j`, params)).rows[0]!.j;
    });
  const errorOf = (user: string, sql: string) => failsAs(user, `select ${sql}`);
  /** A finished rated blitz game; the winner gains 10, the loser loses 10. */
  const game = async (red: string, black: string, result: "red" | "black" | "draw", ago = "1 hour") =>
    (
      await db.query<{ id: string }>(
        `insert into public.games (red, black, base, inc, speed, rated, relay, status, result, reason, moves, red_rating_before, red_rating_after, black_rating_before, black_rating_after, started_at, ended_at)
         values ($1, $2, 300, 3, 'blitz', true, false, 'over', $3, 'resign', array_fill('h2e2'::text, array[40]), 1200, $4, 1200, $5, now() - $6::interval, now() - $6::interval) returning id`,
        [red, black, result, result === "red" ? 1210 : result === "black" ? 1190 : 1200, result === "black" ? 1210 : result === "red" ? 1190 : 1200, ago],
      )
    ).rows[0]!.id;

  beforeAll(async () => {
    for (const [u, name] of [[MOD, "mod_xq"], [X, "xia_xq"], [Y, "yan_xq"], [Z, "zhao_xq"]] as const) {
      await signUp(u, { username: name });
      await db.query(`update public.profiles set birth_month = '1990-01-01' where user_id = $1`, [u]);
      await db.query(
        `insert into public.bot_games (user_id, bot_id, bot_rating, player_color, moves, result, helps, rated, started_at)
         select $1, 'laochen', 800, 'red', array_fill('h2e2'::text, array[30]), 'loss', 0, true, now() from generate_series(1, 3)`,
        [u],
      );
      await db.query(`insert into public.ratings (user_id, kind, rating, rd, games) values ($1, 'blitz', 1200, 80, 40)`, [u]);
    }
    await db.query(`insert into public.moderators (user_id) values ($1)`, [MOD]);
  });

  it("lets a player report the opponent of their own finished game, once, within 7 days", async () => {
    const g = await game(X, Y, "red");
    expect(await errorOf(Z, `public.report_player('${g}', 'engine')`)).toMatch(/not your game/);
    await run(Y, `public.report_player($1, 'engine', '  ')`, [g]);
    expect(await run(Y, `public.reported_game($1)`, [g])).toBe(true);
    expect(await errorOf(Y, `public.report_player('${g}', 'engine')`)).toMatch(/already reported/);
    expect(await errorOf(Y, `public.report_player('${g}', 'cheating')`)).toMatch(/check constraint|already/);
    const old = await game(X, Y, "red", "8 days");
    expect(await errorOf(Y, `public.report_player('${old}', 'engine')`)).toMatch(/too late/);
    expect((await db.query(`select suspect, note from public.reports where game_id = $1`, [g])).rows).toEqual([{ suspect: X, note: null }]);
    expect(await failsAs(Y, `select * from public.reports`)).toMatch(/permission denied/);
  });

  it("keeps the review queue and case to moderators", async () => {
    expect(await errorOf(Y, `public.mod_queue()`)).toMatch(/moderators only/);
    expect(await errorOf(Y, `public.mod_case('xia_xq')`)).toMatch(/moderators only/);
    const queue = await run<{ username: string; reports: number; weight: number }[]>(MOD, `public.mod_queue()`);
    expect(queue.find((c) => c.username === "xia_xq")).toMatchObject({ reports: 1, weight: 0.5 });
    const c = await run<{ reports: { reporter: string; record: { weight: number } }[]; games: unknown[] }>(MOD, `public.mod_case('XIA_XQ')`);
    expect(c.reports).toMatchObject([{ reporter: "yan_xq", reason: "engine", record: { made: 0, upheld: 0, weight: 0.5 } }]);
    expect(c.games.length).toBeGreaterThanOrEqual(2);
  });

  it("confirms a first violation: rated play suspended, ratings reset, victims refunded, reporters told, a public mark", async () => {
    await game(X, Z, "red"); // Zhao lost 10 to Xia
    const out = await run<{ level: number; refunded_games: number }>(MOD, `public.mod_confirm('xia_xq', 'engine moves in 12 games')`);
    expect(out.level).toBe(1);
    expect(out.refunded_games).toBeGreaterThanOrEqual(2);
    const zhao = (await db.query<{ rating: number }>(`select rating from public.ratings where user_id = $1 and kind = 'blitz'`, [Z])).rows[0]!;
    expect(Number(zhao.rating)).toBe(1210);
    expect(await run(Z, `public.my_notices()`)).toMatchObject([{ kind: "refund", data: { points: 10, games: 1 } }]);
    expect(await run(Y, `public.my_notices()`)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "report-upheld" })]));
    const xia = await run<{ eligible: boolean; casual_ok: boolean; sanction: { level: number } }>(X, `public.online_eligibility()`);
    expect(xia).toMatchObject({ eligible: false, casual_ok: true, sanction: { level: 1, closed: false } });
    expect(await errorOf(X, `public.seek(300, 3, '{"range": 200}', false)`)).toMatch(/not ready/);
    expect((await db.query(`select rating, games from public.ratings where user_id = $1 and kind = 'blitz'`, [X])).rows[0]).toMatchObject({ games: 0 });
    expect(await as(null, async (tx) => (await tx.query<{ j: { violation: unknown } }>(`select public.public_profile('xia_xq') as j`)).rows[0]!.j.violation)).toMatchObject({ at: expect.any(String) });
    expect(await run(Y, `public.reporter_record($1)`, [Y]).catch((e: Error) => e.message)).toMatch(/permission denied/);
    expect((await db.query<{ j: { weight: number } }>(`select public.reporter_record($1) as j`, [Y])).rows[0]!.j).toMatchObject({ made: 1, upheld: 1, weight: 0.67 });
    // The log has it, and can't be changed.
    expect((await run<{ action: string }[]>(MOD, `public.mod_log_recent()`))[0]).toMatchObject({ action: "confirm", target: "xia_xq", moderator: "mod_xq" });
    expect(await errorOfQuery(`update public.mod_log set action = 'dismiss'`)).toMatch(/append-only/);
    expect(await errorOfQuery(`delete from public.mod_log`)).toMatch(/append-only/);
  });

  it("makes a second violation stop all online play, closed unless an appeal succeeds", async () => {
    const out = await run<{ level: number; sanction: number }>(MOD, `public.mod_confirm('xia_xq', 'again')`);
    expect(out.level).toBe(2);
    expect(await run(X, `public.online_eligibility()`)).toMatchObject({ casual_ok: false, sanction: { level: 2, closed: false } });
    await db.query(`update public.sanctions set appeal_deadline = now() - interval '1 day' where id = $1`, [out.sanction]);
    expect(await run(X, `public.online_eligibility()->'sanction'->'closed'`)).toBe(true);
    // An appeal received holds the closure; overturned lifts the sanction.
    await run(MOD, `public.mod_appeal($1, 'pending', 'email received')`, [out.sanction]);
    expect(await run(X, `public.online_eligibility()->'sanction'->'closed'`)).toBe(false);
    await run(MOD, `public.mod_appeal($1, 'overturned', 'new evidence')`, [out.sanction]);
    expect(await run(X, `public.online_eligibility()->'sanction'`)).toMatchObject({ level: 1 });
    expect(await errorOf(Y, `public.mod_appeal(${out.sanction}, 'overturned', 'x')`)).toMatch(/moderators only/);
  });

  it("dismisses a case, and bars a persistent false reporter", async () => {
    const g = await game(Y, Z, "black");
    await run(Y, `public.report_player($1, 'engine')`, [g]);
    await run(MOD, `public.mod_dismiss('zhao_xq', 'no evidence')`);
    expect((await db.query(`select status from public.reports where game_id = $1`, [g])).rows).toEqual([{ status: "dismissed" }]);
    await run(MOD, `public.mod_bar_reporter('yan_xq', true, 'reports every loss')`);
    const g2 = await game(Y, Z, "black");
    expect(await errorOf(Y, `public.report_player('${g2}', 'engine')`)).toMatch(/not allowed/);
    expect((await db.query<{ j: { weight: number } }>(`select public.reporter_record($1) as j`, [Y])).rows[0]!.j.weight).toBe(0);
  });

  it("leaves a not-conclusive case open: reports kept, reporters' records unchanged, back in the queue with new evidence", async () => {
    await db.query(`update public.profiles set report_barred = false`);
    const queue = () => run<{ username: string; reports: number; weight: number; last_outcome: string | null }[]>(MOD, `public.mod_queue()`);
    const g1 = await game(Y, X, "black");
    const g2 = await game(Y, X, "black");
    await run(Y, `public.report_player($1, 'engine')`, [g1]);
    await run(Y, `public.report_player($1, 'engine')`, [g2]);
    // One reporter twice counts once.
    const before = (await queue()).find((c) => c.username === "xia_xq")!;
    expect(before.reports).toBe(1);
    const record = async () => (await db.query<{ j: object }>(`select public.reporter_record($1) as j`, [Y])).rows[0]!.j;
    const r0 = await record();
    await run(MOD, `public.mod_inconclusive('xia_xq', 'too few games')`);
    expect((await queue()).find((c) => c.username === "xia_xq")).toBeUndefined();
    expect((await db.query(`select distinct status from public.reports where game_id in ($1, $2)`, [g1, g2])).rows).toEqual([{ status: "open" }]);
    expect(await record()).toEqual(r0);
    expect(await run(MOD, `public.mod_case('xia_xq')->'review'`)).toMatchObject({ outcome: "inconclusive", note: "too few games" });
    // A second reporter is new evidence: the case returns, with the last decision.
    const g3 = await game(Z, X, "black");
    await run(Z, `public.report_player($1, 'chat')`, [g3]);
    expect((await queue()).find((c) => c.username === "xia_xq")).toMatchObject({ reports: 2, last_outcome: "inconclusive" });
  });

  it("shows each game's chat as both browsers recorded it", async () => {
    const g = await game(Y, X, "black");
    const chat = [{ ply: 3, by: "black", phrase: "oops" }];
    await db.query(`update public.games set red_end = $2, black_end = $3 where id = $1`, [g, JSON.stringify({ kind: "end", chat }), JSON.stringify({ kind: "end", chat })]);
    const games = await run<{ id: string; chat: unknown }[]>(MOD, `public.mod_case('xia_xq')->'games'`);
    expect(games.find((x) => x.id === g)!.chat).toEqual({ red: chat, black: chat });
  });

  it("keeps game records 12 months, longer while a case is open", async () => {
    const held = await game(Y, X, "black", "13 months");
    const free = await game(Y, Z, "draw", "13 months");
    for (const g of [held, free]) {
      await db.query(`update public.games set red_end = '{"kind": "end"}' where id = $1`, [g]);
      await db.query(`insert into public.game_log (game_id, by_color, kind, ply, report, at) values ($1, 'red', 'move', 1, '{}', now())`, [g]);
    }
    await db.query(`select public.purge_old_game_records()`);
    const left = async (g: string) => (await db.query<{ n: number }>(`select count(*)::int as n from public.game_log where game_id = $1`, [g])).rows[0]!.n;
    expect(await left(free)).toBe(0); // Yan and Zhao have nothing open
    expect(await left(held)).toBe(1); // Xia has open reports
    expect((await db.query(`select red_end from public.games where id = $1`, [free])).rows).toEqual([{ red_end: null }]);
  });

  it("lists leaderboard players: 30 games, a settled rating, recent play, 10 checked games, no mark", async () => {
    await db.query(`update public.ratings set games = 35, rd = 70, last_played = now() where user_id in ($1, $2) and kind = 'blitz'`, [Z, X]);
    expect(await as(null, async (tx) => (await tx.query(`select public.leaderboard('blitz') as j`)).rows[0])).toEqual({ j: [] });
    for (let i = 0; i < 10; i++)
      await db.query(
        `update public.games set fairplay = '{"status": "checked", "red": {"z": 0, "flags": []}, "black": {"z": 0, "flags": []}}' where id = $1`,
        [await game(Z, MOD, "draw")],
      );
    const board = (await as(null, async (tx) => (await tx.query<{ j: { username: string }[] }>(`select public.leaderboard('blitz') as j`)).rows[0]!.j));
    expect(board.map((r) => r.username)).toEqual(["zhao_xq"]);
  });
});

describe("report triage, phase 1", () => {
  const [TMOD, R1, S1, S2] = ["c3", "c4", "c5", "c6"].map((x) => `00000000-0000-4000-8000-0000000000${x}`) as [string, string, string, string];
  const run = <T>(user: string, sql: string, params: unknown[] = []) =>
    db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
      await tx.exec(`set local role authenticated`);
      return (await tx.query<{ j: T }>(`select ${sql} as j`, params)).rows[0]!.j;
    });
  /** A finished game R1 (red) lost to the suspect (black), then R1's report on it; returns the rules' verdict. */
  const reportOn = async (suspect: string, reason: string, game: { labels?: object; redEnd?: object | null; blackEnd?: object | null; speed?: string } = {}) => {
    const g = (
      await db.query<{ id: string }>(
        `insert into public.games (red, black, base, inc, speed, rated, relay, status, result, reason, moves, labels, red_end, black_end, started_at, ended_at)
         values ($1, $2, 300, 3, $3, true, false, 'over', 'black', 'timeout', array_fill('h2e2'::text, array[40]), $4, $5, $6, now(), now()) returning id`,
        [R1, suspect, game.speed ?? "blitz", JSON.stringify(game.labels ?? {}), game.redEnd === undefined ? null : JSON.stringify(game.redEnd), game.blackEnd === undefined ? null : JSON.stringify(game.blackEnd)],
      )
    ).rows[0]!.id;
    // Straight into the table: the 5-a-day limit is tested with report_player above.
    await db.query(`insert into public.reports (game_id, reporter, suspect, reason) values ($1, $2, $3, $4)`, [g, R1, suspect, reason]);
    return (await db.query<{ verdict: string; rule: string; confidence: string; id: number }>(
      `select t.verdict, t.rule, t.confidence, r.id from public.report_triage t join public.reports r on r.id = t.report_id where r.game_id = $1 and t.source = 'rules'`, [g])).rows[0]!;
  };
  const chatOf = (phrases: string[]) => ({ kind: "end", chat: phrases.map((phrase, i) => ({ ply: 20 + i, by: "black", phrase })) });

  beforeAll(async () => {
    for (const [u, name] of [[TMOD, "tmod_xq"], [R1, "rep_xq"], [S1, "sus_xq"], [S2, "badwordy_xq"]] as const) await signUp(u, { username: name });
    await db.query(`insert into public.moderators (user_id) values ($1)`, [TMOD]);
    // Shadow mode, as phase 1 ran: verdicts only, no automatic steps (phase 2 is tested below).
    await db.query(`update public.triage_config set value = 0 where key ~ '^auto_[a-z]+$'`);
  });

  it("judges stalling by the game's marks", async () => {
    expect(await reportOn(S1, "stalling", { labels: { black: ["stalled"] } })).toMatchObject({ verdict: "valid", rule: "stall-mark" });
    expect(await reportOn(S1, "stalling")).toMatchObject({ verdict: "invalid", rule: "no-stall-mark" });
  });

  it("judges chat by what the suspect sent, from both browsers' records", async () => {
    expect(await reportOn(S1, "chat", { redEnd: chatOf(["wow", "wow", "wow"]), blackEnd: chatOf(["wow"]) })).toMatchObject({ verdict: "valid", rule: "chat-spam" });
    expect(await reportOn(S1, "chat", { redEnd: chatOf(["gg"]), blackEnd: chatOf(["gg"]) })).toMatchObject({ verdict: "invalid", rule: "chat-little" });
    expect(await reportOn(S1, "chat", { redEnd: chatOf(["luck", "oops", "wow"]) })).toMatchObject({ verdict: "inconclusive", rule: "chat-borderline" });
    expect(await reportOn(S1, "chat")).toMatchObject({ verdict: "inconclusive", rule: "no-chat-record" });
  });

  it("judges engine reports by the suspect's standing at that speed", async () => {
    expect(await reportOn(S1, "engine", { speed: "rapid" })).toMatchObject({ verdict: "inconclusive", rule: "few-checked" });
    await db.query(`insert into public.fairplay (user_id, speed, games, score, far, verdict) values ($1, 'blitz', 14, 0.4, 0, 'normal'), ($1, 'lightning', 15, 7.2, 5, 'likely')`, [S1]);
    expect(await reportOn(S1, "engine")).toMatchObject({ verdict: "invalid", rule: "standing-normal" });
    expect(await reportOn(S1, "engine", { speed: "lightning" })).toMatchObject({ verdict: "valid", rule: "standing-likely" });
  });

  it("judges usernames by the private word list, and leaves the rest to an adviser or a person", async () => {
    expect(await reportOn(S2, "username")).toMatchObject({ verdict: "inconclusive", rule: "username-judgement" });
    await db.query(`insert into public.username_blocklist (word) values ('badword')`);
    expect(await reportOn(S2, "username")).toMatchObject({ verdict: "valid", rule: "username-word" });
    expect(await reportOn(S2, "other")).toMatchObject({ verdict: "inconclusive", rule: "free-text" });
    expect(await failsAs(R1, `select * from public.username_blocklist`)).toMatch(/permission denied/);
  });

  it("hands open reports to an adviser and shows its verdict beside the rules'", async () => {
    const pending = await q2<{ report: number; reason: string; suspect: string; rules: { verdict: string } }[]>(`public.triage_pending('ai:test', 100)`);
    const other = pending.find((p) => p.reason === "other")!;
    expect(other).toMatchObject({ suspect: "badwordy_xq", rules: { verdict: "inconclusive" } });
    expect(JSON.stringify(pending)).not.toMatch(/@example\.com/);
    await db.query(`select public.save_triage_advice($1, 'ai:test', 'invalid', 1.4, 'model-x', 'The note describes a normal loss.')`, [other.report]);
    expect((await q2<{ report: number }[]>(`public.triage_pending('ai:test', 100)`)).map((p) => p.report)).not.toContain(other.report);
    const c = await run<{ reports: { id: number; triage: { source: string; confidence: number }[] }[] }>(TMOD, `public.mod_case('badwordy_xq')`);
    expect(c.reports.find((r) => r.id === other.report)!.triage.map((t) => [t.source, Number(t.confidence)])).toEqual([["rules", 0.2], ["ai:test", 1]]);
    expect(await failsAs(TMOD, `select public.save_triage_advice(1, 'x', 'valid', 1, 'x', 'x')`)).toMatch(/permission denied/);
  });

  it("compares each decision with the verdicts, and reports how often they agreed", async () => {
    const queue = await run<{ username: string; triage: { valid: number; invalid: number; inconclusive: number } }[]>(TMOD, `public.mod_queue()`);
    expect(queue.find((c) => c.username === "sus_xq")!.triage).toMatchObject({ valid: 3, invalid: 3 });
    await run(TMOD, `public.mod_dismiss('sus_xq', 'checked each')`);
    const agreement = await run<{ source: string; category: string; decisions: number; agreed: number }[]>(TMOD, `public.triage_agreement()`);
    expect(agreement.find((a) => a.source === "rules" && a.category === "stalling")).toMatchObject({ decisions: 2, agreed: 1 });
    expect(agreement.find((a) => a.source === "rules" && a.category === "chat")).toMatchObject({ decisions: 4, agreed: 1 });
    expect(await failsAs(R1, `select public.triage_agreement()`)).toMatch(/moderators only/);
  });
});

describe("report triage, phase 2: automatic steps, reviewed later", () => {
  const [MOD, REP, CHAT, NAME, STALL, OTHER] = ["d1", "d2", "d3", "d4", "d5", "d6"].map((x) => `00000000-0000-4000-8000-0000000002${x}`) as [string, string, string, string, string, string];
  const run = <T>(user: string, sql: string, params: unknown[] = []) =>
    db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
      await tx.exec(`set local role authenticated`);
      return (await tx.query<{ j: T }>(`select ${sql} as j`, params)).rows[0]!.j;
    });
  const chatOf = (phrases: string[]) => ({ kind: "end", chat: phrases.map((phrase, i) => ({ ply: 20 + i, by: "black", phrase })) });
  /** REP (red) loses a finished game to the suspect (black) and reports it; returns the report and game ids. */
  const reportOn = async (suspect: string, reason: string, game: { labels?: object; chat?: string[] } = {}) => {
    const g = (
      await db.query<{ id: string }>(
        `insert into public.games (red, black, base, inc, speed, rated, relay, status, result, reason, moves, labels, red_end, black_end, started_at, ended_at)
         values ($1, $2, 300, 3, 'blitz', true, false, 'over', 'black', 'timeout', array_fill('h2e2'::text, array[40]), $3, $4, $4, now(), now()) returning id`,
        [REP, suspect, JSON.stringify(game.labels ?? {}), game.chat ? JSON.stringify(chatOf(game.chat)) : null],
      )
    ).rows[0]!.id;
    const r = await db.query<{ id: number }>(`insert into public.reports (game_id, reporter, suspect, reason) values ($1, $2, $3, $4) returning id`, [g, REP, suspect, reason]);
    return { report: r.rows[0]!.id, game: g };
  };
  const status = (report: number) => q2<string>(`(select status from public.reports where id = $1)`, [report]);
  const steps = () => run<{ id: number; kind: string; target: string; source: string; report: number; verdict: string }[]>(MOD, `public.mod_auto_actions()`);

  beforeAll(async () => {
    for (const [u, name] of [[MOD, "p2mod"], [REP, "p2rep"], [CHAT, "p2chatty"], [NAME, "p2rudeword"], [STALL, "p2stall"], [OTHER, "p2other"]] as const) await signUp(u, { username: name });
    await db.query(`insert into public.moderators (user_id) values ($1)`, [MOD]);
    await db.query(`update public.triage_config set value = 1 where key ~ '^auto_[a-z]+$'`);
    await db.query(`insert into public.username_blocklist (word) values ('rudeword') on conflict do nothing`);
  });

  it("pauses a chat spammer's chat for 7 days; more reports on the same episode are just closed", async () => {
    const a = await reportOn(CHAT, "chat", { chat: ["wow", "wow", "wow", "wow", "wow"] });
    expect(await status(a.report)).toBe("auto-closed");
    const info = await run<{ black: { chat_muted_until: string | null }; red: { chat_muted_until: string | null } }>(REP, `public.game_info($1)`, [a.game]);
    expect(Date.parse(info.black.chat_muted_until!) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(info.red.chat_muted_until).toBeNull();
    expect((await run<{ kind: string }[]>(CHAT, `public.my_notices()`)).map((n) => n.kind)).toContain("chat-muted");
    const b = await reportOn(CHAT, "chat", { chat: ["oops", "oops", "oops"] });
    expect(await status(b.report)).toBe("auto-closed");
    const mine = (await steps()).filter((s) => s.target === "p2chatty");
    expect(mine.map((s) => s.kind).sort()).toEqual(["close-report", "mute-chat"]);
    // Nobody but a moderator sees the list; the reporter's record doesn't count undecided steps.
    expect(await failsAs(REP, `select public.mod_auto_actions()`)).toMatch(/moderators only/);
    expect(await q2(`public.reporter_record($1)`, [REP])).toMatchObject({ made: 0, upheld: 0 });
  });

  it("keeping a step decides the report; a second offence after a kept step goes to a person", async () => {
    const mute = (await steps()).find((s) => s.kind === "mute-chat")!;
    await run(MOD, `public.mod_review_auto($1, true, 'clear spam')`, [mute.id]);
    expect(await status(mute.report)).toBe("upheld");
    expect((await run<{ kind: string }[]>(REP, `public.my_notices()`)).map((n) => n.kind)).toContain("report-upheld");
    expect(await failsAs(MOD, `select public.mod_review_auto(${mute.id}, false)`)).toMatch(/already reviewed/);
    await db.query(`update public.reports set created_at = now() - interval '9 days' where suspect = $1`, [CHAT]);
    await db.query(`update public.auto_actions set at = now() - interval '9 days' where target = $1`, [CHAT]);
    const again = await reportOn(CHAT, "chat", { chat: ["wow", "wow", "wow"] });
    expect(await status(again.report)).toBe("open");
  });

  it("hides an offensive username until the player chooses another, and undoing gives it back", async () => {
    const r = await reportOn(NAME, "username");
    expect(await status(r.report)).toBe("auto-closed");
    const hidden = await q2<{ username: string; username_chosen: boolean }>(`(select to_jsonb(p) from public.profiles p where user_id = $1)`, [NAME]);
    expect(hidden.username).toMatch(/^player-\d{7}$/);
    expect(hidden.username_chosen).toBe(false);
    expect(await q2(`public.username_problem('P2RudeWord')`)).toBe("reserved");
    const step = (await steps()).find((s) => s.target === hidden.username)!;
    await run(MOD, `public.mod_review_auto($1, false, 'a surname, not a slur')`, [step.id]);
    expect(await q2(`(select username from public.profiles where user_id = $1)`, [NAME])).toBe("p2rudeword");
    expect(await status(r.report)).toBe("open");
    expect((await run<{ kind: string }[]>(NAME, `public.my_notices()`)).map((n) => n.kind)).not.toContain("username-hidden");
  });

  it("lets an adviser act only when it's confident and the rules don't disagree; engine and 'other' findings stay with a person", async () => {
    const a = await reportOn(OTHER, "other");
    await db.query(`select public.save_triage_advice($1, 'ai:test', 'valid', 0.95, 'm', 'Sounds bad.')`, [a.report]);
    expect(await status(a.report)).toBe("open");
    await db.query(`select public.save_triage_advice($1, 'ai:test', 'invalid', 0.7, 'm', 'Probably fine.')`, [a.report]);
    expect(await status(a.report)).toBe("open");
    expect(await q2(`public.save_triage_advice($1, 'ai:test', 'invalid', 0.9, 'm', 'The note describes a normal loss.')`, [a.report])).toBeGreaterThan(0);
    expect(await status(a.report)).toBe("auto-closed");
    // The rules say stalled; an adviser saying "invalid" doesn't overrule them.
    await db.query(`update public.triage_config set value = 0 where key = 'auto_stalling'`);
    const s = await reportOn(STALL, "stalling", { labels: { black: ["stalled"] } });
    await db.query(`update public.triage_config set value = 1 where key = 'auto_stalling'`);
    expect(await q2(`public.save_triage_advice($1, 'ai:test', 'invalid', 0.99, 'm', 'Looks fine.')`, [s.report])).toBeNull();
    expect(await status(s.report)).toBe("open");
  });

  it("switches a category off when its steps are undone too often, and a moderator can switch it back", async () => {
    const closed: number[] = [];
    for (let i = 0; i < 3; i++) closed.push((await reportOn(STALL, "stalling")).report);
    const mine = (await steps()).filter((s) => s.target === "p2stall" && closed.includes(s.report));
    expect(mine).toHaveLength(3);
    await run(MOD, `public.mod_review_auto($1, true)`, [mine[0]!.id]);
    expect(await status(mine[0]!.report)).toBe("dismissed");
    await run(MOD, `public.mod_review_auto($1, false, 'was stalling after all')`, [mine[1]!.id]);
    expect((await run<{ category: string; on: boolean }[]>(MOD, `public.mod_triage_switches()`)).find((c) => c.category === "stalling")!.on).toBe(true);
    await run(MOD, `public.mod_review_auto($1, false)`, [mine[2]!.id]);
    const sw = (await run<{ category: string; on: boolean; undone: number; reviewed: number }[]>(MOD, `public.mod_triage_switches()`)).find((c) => c.category === "stalling")!;
    expect(sw).toMatchObject({ on: false, undone: 2, reviewed: 3 });
    expect((await run<{ action: string }[]>(MOD, `public.mod_log_recent()`))[0]).toMatchObject({ action: "auto-off" });
    const agreement = await run<{ source: string; category: string; decisions: number; agreed: number }[]>(MOD, `public.triage_agreement()`);
    expect(agreement.find((x) => x.source === "rules" && x.category === "stalling")).toMatchObject({ decisions: 5, agreed: 2 }); // phase 1's two decisions, then keep, undo, undo
    // Off: a new report stays open.
    expect(await status((await reportOn(STALL, "stalling")).report)).toBe("open");
    await run(MOD, `public.mod_set_auto('stalling', true, 'fixed the rule')`);
    expect(await failsAs(REP, `select public.mod_set_auto('chat', false, 'x')`)).toMatch(/moderators only/);
  });

  it("gathers what the daily summary covers and keeps the summary for the review page", async () => {
    await db.query(`select public.send_feedback('idea', 'Please add a puzzle streak')`);
    const input = await q2<{ steps: { kind: string; n: number }[]; waiting_review: number; feedback: { message: string }[]; switched_off: object[]; switches: Record<string, number> }>(`public.triage_digest_input()`);
    expect(input.steps.length).toBeGreaterThan(0);
    expect(input.waiting_review).toBeGreaterThan(0);
    expect(input.switched_off).toHaveLength(1);
    expect(Object.keys(input.switches).sort()).toEqual(["auto_chat", "auto_engine", "auto_other", "auto_stalling", "auto_username"]);
    expect(input.feedback.map((f) => f.message)).toContain("Please add a puzzle streak");
    expect(JSON.stringify(input)).not.toMatch(/@example\.com/);
    await db.query(`select public.save_triage_digest('ai:test', '## Today\nAll quiet.', '{"waiting_review": 3}')`);
    expect(await run(MOD, `public.mod_latest_digest()`)).toMatchObject({ source: "ai:test", summary: "## Today\nAll quiet." });
    expect(await failsAs(REP, `select public.mod_latest_digest()`)).toMatch(/moderators only/);
    expect(await failsAs(MOD, `select public.triage_digest_input()`)).toMatch(/permission denied/);
    // Since the last summary: nothing new.
    expect((await q2<{ steps: object[] }>(`public.triage_digest_input()`)).steps).toEqual([]);
  });
});

describe("game history (after M20)", () => {
  const [HA, HB, HK] = ["e2", "e3", "e4"].map((x) => `00000000-0000-4000-8000-0000000000${x}`) as [string, string, string];
  const run = <T>(user: string | null, sql: string, params: unknown[] = []) =>
    db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ?? ""]);
      await tx.exec(`set local role ${user ? "authenticated" : "anon"}`);
      return (await tx.query<{ j: T }>(`select ${sql} as j`, params)).rows[0]!.j;
    });
  let adults = "";
  let withChild = "";

  beforeAll(async () => {
    await signUp(HA, { username: "hist_a" });
    await signUp(HB, { username: "hist_b" });
    await signUp(HK, { username: "hist_kid" });
    await db.query(`update public.profiles set birth_month = '1990-01-01' where user_id in ($1, $2)`, [HA, HB]);
    await db.query(`update public.profiles set birth_month = date_trunc('month', now() - interval '12 years') where user_id = $1`, [HK]);
    const game = async (red: string, black: string, result: string, ago: string, rated = true) =>
      (
        await db.query<{ id: string }>(
          `insert into public.games (red, black, base, inc, speed, rated, relay, status, result, reason, moves, red_rating_before, red_rating_after, black_rating_before, black_rating_after, started_at, ended_at)
           values ($1, $2, 300, 3, 'blitz', $5, false, 'over', $3, 'resign', array['h2e2', 'h9g7'], 1200, 1210, 1200, 1190, now() - $4::interval, now() - $4::interval) returning id`,
          [red, black, result, ago, rated],
        )
      ).rows[0]!.id;
    adults = await game(HA, HB, "red", "2 hours");
    withChild = await game(HK, HA, "black", "1 hour");
    await game(HB, HA, "draw", "3 hours", false);
  });

  it("lists a player's own games, newest first and paged, from their side", async () => {
    const all = await run<{ id: string; color: string; result: string; opponent: string; rating_after: number }[]>(HA, `public.my_games()`);
    expect(all.map((g) => [g.opponent, g.color, g.result])).toEqual([["hist_kid", "black", "win"], ["hist_b", "red", "win"], ["hist_b", "black", "draw"]]);
    const page2 = await run<{ id: string }[]>(HA, `public.my_games($1, 1)`, [new Date(Date.now() - 90 * 60_000).toISOString()]);
    expect(page2.map((g) => g.id)).toEqual([adults]);
    expect(await run(null, `public.my_games()`).catch((e: Error) => e.message)).toMatch(/permission denied/);
  });

  it("shows anyone a player's games, but never a game with a player under 16, nor a child's list", async () => {
    const theirs = await run<{ id: string }[]>(null, `public.player_games('HIST_A')`);
    expect(theirs.map((g) => g.id)).not.toContain(withChild);
    expect(theirs.map((g) => g.id)).toContain(adults);
    expect(await run(null, `public.player_games('hist_kid')`)).toBeNull();
    // A finished game opens to anyone, unless a child played in it; its players can always open it.
    expect(await run<{ me: string | null }>(null, `public.game_info($1)`, [adults])).toMatchObject({ me: null, status: "over" });
    expect(await run(null, `public.game_info($1)`, [withChild])).toBeNull();
    expect(await run(HB, `public.game_info($1)`, [withChild])).toBeNull();
    expect(await run<{ me: string }>(HK, `public.game_info($1)`, [withChild])).toMatchObject({ me: "red" });
  });

  it("summarises a player's online results and rating history per speed", async () => {
    const s = await run<{ blitz: { history: { rating: number }[]; results: { red: { wins: number }; black: { wins: number; draws: number } } } }>(HA, `public.my_online_stats()`);
    expect(s.blitz.history.map((h) => h.rating)).toEqual([1210, 1190]);
    expect(s.blitz.results).toMatchObject({ red: { games: 1, wins: 1 }, black: { games: 2, wins: 1, draws: 1 } });
  });
});

describe("site settings: the operator's contact block", () => {
  const SM = "00000000-0000-4000-8000-0000000000e5";
  const run = <T>(user: string | null, sql: string, params: unknown[] = []) =>
    db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ?? ""]);
      await tx.exec(`set local role ${user ? "authenticated" : "anon"}`);
      return (await tx.query<{ j: T }>(`select ${sql} as j`, params)).rows[0]!.j;
    });

  it("starts from the template, anyone can read it, and only moderators change it (logged)", async () => {
    await signUp(SM, { username: "settings_mod" });
    expect(await run(null, `public.site_contact()`)).toEqual({ name: "Xiangqi School 象棋学堂", address: "P.O. Box 10000, Cupertino, CA 95014, USA", phone: null, email: "jianjetzhu@gmail.com" });
    const set = `public.mod_set_contact('Xiangqi School', 'P.O. Box 42, Cupertino, CA 95015, USA', ' +1 408 555 0100 ', 'help@example.com', 'new box')`;
    expect(await failsAs(SM, `select ${set}`)).toMatch(/moderators only/);
    await db.query(`insert into public.moderators (user_id) values ($1)`, [SM]);
    expect(await failsAs(SM, `select public.mod_set_contact('X', 'Box 1', null, 'not-an-email', 'x')`)).toMatch(/valid email/);
    await run(SM, set);
    expect(await run(null, `public.site_contact()`)).toEqual({ name: "Xiangqi School", address: "P.O. Box 42, Cupertino, CA 95015, USA", phone: "+1 408 555 0100", email: "help@example.com" });
    expect((await run<{ action: string; details: { note: string } }[]>(SM, `public.mod_log_recent()`))[0]).toMatchObject({ action: "set-contact", details: { note: "new box" } });
    expect(await failsAs(SM, `update public.site_settings set value = '{}'`)).toMatch(/permission denied/);
  });
});

describe("feedback and donation links (M21)", () => {
  const FM = "00000000-0000-4000-8000-0000000001f1";
  const FP = "00000000-0000-4000-8000-0000000001f2";
  /** Runs one select as a user or a guest, from a network address (sent as Supabase's headers). */
  const run = <T>(user: string | null, sql: string, ip = "203.0.113.7") =>
    db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.headers', $2, true)`, [user ?? "", JSON.stringify({ "x-forwarded-for": `${ip}, 10.0.0.1` })]);
      await tx.exec(`set local role ${user ? "authenticated" : "anon"}`);
      return (await tx.query<{ j: T }>(`select ${sql} as j`)).rows[0]!.j;
    });
  const fails = (user: string | null, sql: string, ip?: string) => run(user, sql, ip).then(() => "no error", (e: Error) => e.message);

  it("takes feedback from guests and players, with limits, and only moderators read it", async () => {
    await signUp(FM, { username: "feedback_mod" });
    await signUp(FP, { username: "feedback_player" });
    await run(null, `public.send_feedback('idea', '  More endgame lessons  ', '/en/learn/', 'abc1234', 'en', true)`);
    await run(FP, `public.send_feedback('problem', 'The clock froze', '/en/game/', 'abc1234', 'zh', true)`);
    expect(await fails(null, `public.send_feedback('idea', '   ')`)).toMatch(/write something/);
    expect(await fails(null, `public.send_feedback('spam', 'x')`)).toMatch(/check constraint/);
    for (let i = 0; i < 4; i++) await run(null, `public.send_feedback('other', 'more ${i}')`);
    expect(await fails(null, `public.send_feedback('other', 'sixth')`)).toMatch(/limit/);
    // Another network still gets through; the address itself is never kept.
    await run(null, `public.send_feedback('other', 'from elsewhere')`, "198.51.100.9");
    const kept = await q2<string[]>(`(select jsonb_agg(network) from public.feedback where user_id is null and network is not null)`);
    expect(new Set(kept).size).toBe(2);
    expect(JSON.stringify(kept)).not.toContain("203.0.113.7");
    for (let i = 0; i < 4; i++) await run(FP, `public.send_feedback('idea', 'idea ${i}')`);
    expect(await fails(FP, `public.send_feedback('idea', 'one too many')`)).toMatch(/limit/);

    expect(await fails(FP, `public.mod_feedback()`)).toMatch(/moderators only/);
    expect(await fails(FP, `(select count(*) from public.feedback)`)).toMatch(/permission denied/);
    await db.query(`insert into public.moderators (user_id) values ($1)`, [FM]);
    const items = await run<{ id: number; message: string; username: string | null; reply_to: string | null; kind: string }[]>(FM, `public.mod_feedback()`);
    expect(items.filter((f) => f.message !== "Please add a puzzle streak")).toHaveLength(11);
    const guest = items.find((f) => f.message === "More endgame lessons")!;
    expect(guest).toMatchObject({ username: null, reply_to: null, kind: "idea" }); // a guest can't ask for a reply
    expect(items.find((f) => f.message === "The clock froze")).toMatchObject({ username: "feedback_player", reply_to: "2@example.com" });
    expect(items.find((f) => f.message === "idea 0")).toMatchObject({ reply_to: null });

    await run(FM, `public.mod_set_feedback(${guest.id}, 'planned', 'next lesson batch')`);
    expect(await run(FM, `public.mod_feedback('planned')`)).toMatchObject([{ message: "More endgame lessons", note: "next lesson batch" }]);
    expect(await run(FM, `public.mod_feedback_counts()`)).toMatchObject({ new: 11, planned: 1 });
    await run(FM, `public.mod_set_feedback(${guest.id}, 'done')`);
    await db.query(`update public.feedback set at = now() - interval '13 months' where id = $1`, [guest.id]);
    expect(await q2(`public.purge_old_feedback()`)).toBe(1);
  });

  it("keeps the donation links, which only moderators set, to Stripe and GitHub Sponsors only", async () => {
    expect(await run(null, `public.site_donations()`)).toEqual({ stripe: null, github: null });
    expect(await fails(FP, `public.mod_set_donations('https://buy.stripe.com/abc', null, 'x')`)).toMatch(/moderators only/);
    expect(await fails(FM, `public.mod_set_donations('https://evil.example/pay', null, 'x')`)).toMatch(/Stripe link/);
    expect(await fails(FM, `public.mod_set_donations(null, 'https://github.com/jetzhu', 'x')`)).toMatch(/GitHub link/);
    await run(FM, `public.mod_set_donations(' https://buy.stripe.com/test_00g5kE ', 'https://github.com/sponsors/jetzhu', 'accounts ready')`);
    expect(await run(null, `public.site_donations()`)).toEqual({ stripe: "https://buy.stripe.com/test_00g5kE", github: "https://github.com/sponsors/jetzhu" });
    expect((await run<{ action: string }[]>(FM, `public.mod_log_recent()`))[0]).toMatchObject({ action: "set-donations" });
  });
});

describe("coaching (M23)", () => {
  const [COACH, KID, TEEN, KID2, YOUNG, MOD3, PARENT] = ["01", "02", "03", "04", "05", "06", "07"].map((x) => `00000000-0000-4000-8000-0000000003${x}`) as [string, string, string, string, string, string, string];
  const run = <T>(user: string | null, sql: string, params: unknown[] = []) =>
    db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ?? ""]);
      await tx.exec(`set local role ${user ? "authenticated" : "anon"}`);
      return (await tx.query<{ j: T }>(`select ${sql} as j`, params)).rows[0]!.j;
    });
  const hint = (user: string | null, sql: string, params: unknown[] = []) =>
    db
      .transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ?? ""]);
        await tx.exec(`set local role ${user ? "authenticated" : "anon"}`);
        await tx.query(`select ${sql}`, params);
      })
      .then(() => "no error", (e: { hint?: string; message: string }) => e.hint ?? e.message);
  /** Born `years` ago (by month); accounts made a month ago. */
  const born = async (user: string, years: number) => {
    await db.query(`alter table public.profiles disable trigger profiles_before_update`);
    await db.query(`update public.profiles set birth_month = date_trunc('month', now() - make_interval(years => $2) - interval '2 months')::date, created_at = now() - interval '30 days' where user_id = $1`, [user, years]);
    await db.query(`alter table public.profiles enable trigger profiles_before_update`);
  };
  const lastMail = () => q2<{ to_email: string; template: string; data: { token: string; student: string; coach: string } }>(`(select to_jsonb(m) from public.mail_outbox m where template = 'guardian-confirm' order by id desc limit 1)`);
  const finished = async (red: string, black: string) =>
    (await db.query<{ id: string }>(
      `insert into public.games (red, black, base, inc, speed, rated, relay, status, result, reason, moves, started_at, ended_at)
       values ($1, $2, 300, 3, 'blitz', true, false, 'over', 'red', 'resign', array_fill('h2e2'::text, array[30]), now(), now()) returning id`, [red, black])).rows[0]!.id;

  beforeAll(async () => {
    for (const [u, name] of [[COACH, "coach_lin"], [KID, "kid_wei"], [TEEN, "teen_li"], [KID2, "kid_two"], [YOUNG, "young_coach"], [MOD3, "mod_three"], [PARENT, "parent_wu"]] as const) await signUp(u, { username: name });
    await born(COACH, 40);
    await born(PARENT, 38);
    await born(KID, 14);
    await born(KID2, 13);
    await born(TEEN, 17);
    await born(YOUNG, 17);
    await db.query(`insert into public.moderators (user_id) values ($1)`, [MOD3]);
  });

  it("asks a guardian by email for a player under 16; the guardian confirms, and may lower the line", async () => {
    expect(await hint(KID, `public.request_coach('young_coach')`)).toBe("coach-age");
    expect(await hint(KID, `public.request_coach('mod_three')`)).toBe("coach-birth"); // no birth month given
    expect(await hint(KID, `public.request_coach('coach_lin')`)).toBe("guardian-email");
    expect(await hint(KID, `public.request_coach('coach_lin', null, false, '2@example.com')`)).toBe("guardian-self");
    expect(await run(KID, `public.request_coach('coach_lin', null, false, 'Mum@Example.com')`)).toMatchObject({ status: "guardian", coach: "coach_lin" });
    const mail = await lastMail();
    expect(mail).toMatchObject({ to_email: "mum@example.com", template: "guardian-confirm", data: { student: "kid_wei", coach: "coach_lin" } });
    expect(mail.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(await q2(`(select count(*)::int from public.coach_links where token_hash = $1)`, [mail.data.token])).toBe(0); // only its hash is kept
    // The coach doesn't see it until the guardian confirms.
    expect((await run<{ requests: object[] }>(COACH, `public.my_coaching()`)).requests).toEqual([]);
    expect(await run(null, `public.guardian_view($1)`, ["not-a-token"])).toBeNull();
    expect(await run(null, `public.guardian_view($1)`, [mail.data.token])).toMatchObject({ student: "kid_wei", coach: "coach_lin", status: "guardian", line_lowered: false });
    await run(null, `public.guardian_answer($1, true, true)`, [mail.data.token]);
    expect(await q2(`(select guardian_email from public.coach_links where student = $1)`, [KID])).toBeNull();
    expect(await run(null, `public.guardian_view($1)`, [mail.data.token])).toMatchObject({ status: "coach", line_lowered: true });
    expect(await q2<{ action: string }>(`(select to_jsonb(l) from public.mod_log l where action = 'guardian-line' order by id desc limit 1)`)).toMatchObject({ action: "guardian-line" });
    // With the line lowered, the next request needs no confirmation.
    expect(await run(KID, `public.request_coach('parent_wu', null, true)`)).toMatchObject({ status: "coach" });
  });

  it("the coach accepts; a player 16 or over links by a one-time code without a guardian", async () => {
    const coaching = await run<{ requests: { id: number; student: string }[] }>(COACH, `public.my_coaching()`);
    const req = coaching.requests.find((r) => r.student === "kid_wei")!;
    expect(await hint(TEEN, `public.coach_answer(${req.id}, true)`)).toBe("no such request");
    expect(await run(COACH, `public.coach_answer(${req.id}, true)`)).toBe("active");
    expect(await hint(YOUNG, `public.create_coach_code()`)).toBe("coach-age");
    const { code } = await run<{ code: string }>(COACH, `public.create_coach_code()`);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(await run(TEEN, `public.request_coach(null, $1)`, [code.toLowerCase()])).toMatchObject({ status: "coach", coach: "coach_lin" });
    expect(await hint(KID2, `public.request_coach(null, $1, false, 'dad@example.com')`, [code])).toBe("code"); // used once
    const teen = (await run<{ requests: { id: number; student: string }[] }>(COACH, `public.my_coaching()`)).requests.find((r) => r.student === "teen_li")!;
    await run(COACH, `public.coach_answer(${teen.id}, true)`);
    expect((await run<{ students: { student: string }[] }>(COACH, `public.my_coaching()`)).students.map((x) => x.student)).toEqual(["kid_wei", "teen_li"]);
  });

  it("shows a coach their students' finished games, with other children hidden, and logs every game opened", async () => {
    const vsChild = await finished(KID, KID2);
    const vsTeen = await finished(TEEN, KID);
    const games = await run<{ id: string; opponent: string | null; opponent_under16: boolean }[]>(COACH, `public.coach_student_games('kid_wei')`);
    expect(games.find((g) => g.id === vsChild)).toMatchObject({ opponent: null, opponent_under16: true });
    expect(games.find((g) => g.id === vsTeen)).toMatchObject({ opponent: "teen_li", opponent_under16: false });
    expect(await hint(YOUNG, `public.coach_student_games('kid_wei')`)).toBe("not your student");
    const g = await run<{ red: { username: string | null }; black: { username: string | null; under16?: boolean }; coach_of: string }>(COACH, `public.coach_game_info($1)`, [vsChild]);
    expect(g).toMatchObject({ coach_of: "red", red: { username: "kid_wei" }, black: { username: null, under16: true } });
    expect(await run(YOUNG, `public.coach_game_info($1)`, [vsChild])).toBeNull();
    expect((await run<{ visits: { coach: string; game: string }[] }>(KID, `public.my_coaching()`)).visits).toEqual([expect.objectContaining({ coach: "coach_lin", game: vsChild })]);
  });

  it("holds a coach's 16th student under 16 for a moderator, and caps a parent at 3 children", async () => {
    await db.query(`update public.triage_config set value = 1 where key = 'coach_under16_cap'`);
    await db.query(`insert into public.guardian_settings (student, line_lowered) values ($1, true)`, [KID2]);
    await run(KID2, `public.request_coach('coach_lin')`);
    const req = (await run<{ requests: { id: number; student: string }[] }>(COACH, `public.my_coaching()`)).requests.find((r) => r.student === "kid_two")!;
    expect(await run(COACH, `public.coach_answer(${req.id}, true)`)).toBe("review");
    expect(await hint(COACH, `public.mod_coaching()`)).toBe("moderators only");
    expect((await run<{ review: { id: number; student: string }[] }>(MOD3, `public.mod_coaching()`)).review).toEqual([expect.objectContaining({ id: req.id, student: "kid_two", students_under16: 1 })]);
    await run(MOD3, `public.mod_link(${req.id}, 'approve', 'school club')`);
    expect(await q2(`(select status from public.coach_links where id = $1)`, [req.id])).toBe("active");
    await db.query(`update public.triage_config set value = 15 where key = 'coach_under16_cap'`);
    await db.query(`update public.triage_config set value = 1 where key = 'family_cap'`);
    expect(await hint(KID2, `public.request_coach('parent_wu', null, true)`)).toBe("family-cap");
    await db.query(`update public.triage_config set value = 3 where key = 'family_cap'`);
  });

  it("lets either side or the guardian end a link, and moderators bar a coach after a report", async () => {
    // A guardian ends a link from the email's page (its link stays good for 90 days after answering).
    await run(null, `public.guardian_end($1)`, [(await lastMail()).data.token]);
    expect(await q2(`(select ended_by from public.coach_links where coach = $1 and student = $2)`, [COACH, KID])).toBe("guardian");
    const link = await q2<number>(`(select id from public.coach_links where coach = $1 and student = $2 and status = 'active')`, [COACH, TEEN]);
    await run(TEEN, `public.report_coach(${link}, 'asked for my phone number')`);
    expect(await hint(TEEN, `public.report_coach(${link}, 'again')`)).toBe("once");
    await run(TEEN, `public.end_coach_link(${link})`);
    expect(await hint(COACH, `public.coach_student_games('teen_li')`)).toBe("not your student");
    const mod = await run<{ reports: { id: number; coach: string; note: string }[] }>(MOD3, `public.mod_coaching()`);
    expect(mod.reports).toEqual([expect.objectContaining({ coach: "coach_lin", note: "asked for my phone number" })]);
    await run(MOD3, `public.mod_bar_coach('coach_lin', true, 'asked a child for contact details')`);
    await run(MOD3, `public.mod_close_coach_report(${mod.reports[0]!.id}, 'barred')`);
    expect(await q2(`(select count(*)::int from public.coach_links where coach = $1 and status = 'active')`, [COACH])).toBe(0);
    expect(await hint(KID, `public.request_coach('coach_lin')`)).toBe("coach-barred");
    expect((await run<{ links: object[]; barred: boolean }>(MOD3, `public.mod_coach_links('coach_lin')`)).barred).toBe(true);
  });

  it("sends mail through the outbox: claimed once, cleared when sent, retried on error, within the hourly limit", async () => {
    await db.query(`delete from public.mail_outbox`);
    for (let i = 0; i < 3; i++) await db.query(`select public.queue_mail($1, 'test', 'zh', '{"token": "secret"}', null)`, [`p${i}@example.com`]);
    const batch = await q2<{ id: number; to: string; lang: string }[]>(`public.mail_claim(2)`);
    expect(batch.map((m) => m.to).sort()).toEqual(["p0@example.com", "p1@example.com"]);
    expect((await q2<object[]>(`public.mail_claim(5)`)).length).toBe(1); // the claimed two aren't handed out again
    await db.query(`select public.mail_done($1)`, [batch[0]!.id]);
    await db.query(`select public.mail_done($1, 'smtp 421')`, [batch[1]!.id]);
    expect(await q2(`(select data from public.mail_outbox where id = $1)`, [batch[0]!.id])).toEqual({});
    expect(await q2(`(select last_error from public.mail_outbox where id = $1)`, [batch[1]!.id])).toBe("smtp 421");
    await db.query(`update public.mail_outbox set sent_at = now() where sent_at is null`);
    for (let i = 0; i < 99; i++) await db.query(`insert into public.mail_outbox (to_email, template, sent_at) values ('x@example.com', 'test', now())`);
    await db.query(`select public.queue_mail('late@example.com', 'test', 'en', '{}', null)`);
    expect(await q2(`public.mail_claim(5)`)).toEqual([]);
    expect(await failsAs(KID, `select public.mail_claim(5)`)).toMatch(/permission denied/);
  });
});

describe("account security (M23b)", () => {
  const [ACC, CO, MODX] = ["01", "02", "03"].map((x) => `00000000-0000-4000-8000-0000000004${x}`) as [string, string, string];
  const now = () => Math.floor(Date.now() / 1000);
  /** Runs as a user with these session claims (sign-in times, two-factor level). */
  const run = <T>(user: string | null, sql: string, params: unknown[] = [], claims: object = { aal: "aal1", amr: [{ method: "password", timestamp: now() }] }) =>
    db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [user ?? "", JSON.stringify(claims)]);
      await tx.exec(`set local role ${user ? "authenticated" : "anon"}`);
      return (await tx.query<{ j: T }>(`select ${sql} as j`, params)).rows[0]!.j;
    });
  const hint = (user: string | null, sql: string, params: unknown[] = [], claims?: object) =>
    run(user, sql, params, claims).then(() => "no error", (e: { hint?: string; message: string }) => e.hint ?? e.message);
  const mail = (template: string) => q2<{ to_email: string; data: { token: string; reminder?: boolean }; send_after: string } | null>(`(select to_jsonb(m) from public.mail_outbox m where template = $1 order by id desc limit 1)`, [template]);
  const email = (u: string) => q2<string>(`(select email from auth.users where id = $1)`, [u]);

  beforeAll(async () => {
    for (const [u, name] of [[ACC, "acc_owner"], [CO, "coach_by_mail"], [MODX, "mod_x"]] as const) await signUp(u, { username: name });
    await db.query(`alter table public.profiles disable trigger profiles_before_update`);
    await db.query(`update public.profiles set birth_month = '1980-01-01', created_at = now() - interval '30 days' where user_id in ($1, $2)`, [ACC, CO]);
    await db.query(`alter table public.profiles enable trigger profiles_before_update`);
    await db.query(`update auth.users set email = 'coach.lin@example.com' where id = $1`, [CO]);
    await db.query(`insert into public.moderators (user_id) values ($1)`, [MODX]);
  });

  it("links a coach by email without showing whether the address has an account", async () => {
    const real = await run<{ masked: string }>(ACC, `public.request_coach_by_email('Coach.Lin@example.com')`);
    const none = await run<{ masked: string }>(ACC, `public.request_coach_by_email('nobody@example.com')`);
    expect(real).toEqual({ masked: "c***@example.com" });
    expect(none).toEqual({ masked: "n***@example.com" });
    const mine = await run<{ as_student: object[]; email_requests: { masked: string }[] }>(ACC, `public.my_coaching()`);
    expect(mine.as_student).toEqual([]); // the coach's username isn't shown before they accept
    expect(mine.email_requests.map((r) => r.masked).sort()).toEqual(["c***@example.com", "n***@example.com"]);
    // The coach sees the request, and got an email about it.
    const req = (await run<{ requests: { id: number; student: string }[] }>(CO, `public.my_coaching()`)).requests[0]!;
    expect(req.student).toBe("acc_owner");
    expect(await mail("coach-request")).toMatchObject({ to_email: "coach.lin@example.com" });
    await run(CO, `public.coach_answer(${req.id}, true)`);
    const after = await run<{ as_student: { coach: string }[]; email_requests: { masked: string }[] }>(ACC, `public.my_coaching()`);
    expect(after.as_student.map((l) => l.coach)).toEqual(["coach_by_mail"]);
    expect(after.email_requests.map((r) => r.masked)).toEqual(["n***@example.com"]);
    for (let i = 0; i < 3; i++) await run(ACC, `public.request_coach_by_email('x${i}@example.com')`);
    expect(await hint(ACC, `public.request_coach_by_email('x9@example.com')`)).toBe("email-limit");
  });

  it("needs two-factor sign-in for moderator work", async () => {
    expect(await hint(MODX, `public.mod_queue()`, [], { aal: "aal1" })).toBe("mfa");
    expect(await hint(MODX, `public.mod_feedback()`, [], { aal: "aal2" })).toBe("no error");
  });

  it("changes the email after the old address approves, after a check that it's you", async () => {
    expect(await hint(ACC, `public.start_email_change('new1@example.com')`, [], { aal: "aal1", amr: [{ method: "password", timestamp: now() - 3600 }] })).toBe("reauth");
    expect(await hint(ACC, `public.start_email_change('coach.lin@example.com')`)).toBe("taken");
    await run(ACC, `public.start_email_change('New1@Example.com')`);
    expect(await hint(ACC, `public.start_email_change('other@example.com')`)).toBe("pending");
    const toNew = await mail("email-change-new");
    expect(toNew!.to_email).toBe("new1@example.com");
    expect(await run(null, `public.email_change_view($1)`, [toNew!.data.token])).toMatchObject({ kind: "new", status: "confirm-new", new: "n***@example.com" });
    expect(await run(null, `public.confirm_new_email($1)`, [toNew!.data.token])).toBe("waiting");
    expect(await run<{ change: { status: string } }>(ACC, `public.my_email_change()`)).toMatchObject({ change: { status: "waiting" } });
    const toOld = await q2<{ to_email: string; data: { token: string }; cancel_key: string }[]>(`(select jsonb_agg(to_jsonb(m) order by send_after) from public.mail_outbox m where template = 'email-change-old')`);
    expect(toOld.map((m) => m.to_email)).toEqual(Array(4).fill("1@example.com")); // now, and reminders on days 1, 5, 9
    expect(await run(null, `public.answer_old_email($1, true)`, [toOld[0]!.data.token])).toBe("done");
    expect(await email(ACC)).toBe("new1@example.com");
    expect(await q2(`(select count(*)::int from public.mail_outbox where template = 'email-change-old' and sent_at is null)`)).toBe(0); // reminders withdrawn
    expect((await mail("email-changed"))!.to_email).toBe("1@example.com");
  });

  it("completes by itself after 10 days without an answer; a deny locks changes for longer each time", async () => {
    const start = async (to: string) => {
      await run(ACC, `public.start_email_change($1)`, [to]);
      await run(null, `public.confirm_new_email($1)`, [(await mail("email-change-new"))!.data.token]);
      return (await mail("email-change-old"))!.data.token; // the newest: a reminder carries the same link
    };
    await start("new2@example.com");
    await db.query(`update public.email_changes set due_at = now() - interval '1 minute' where status = 'waiting'`);
    expect(await q2(`public.complete_due_email_changes()`)).toBe(1);
    expect(await email(ACC)).toBe("new2@example.com");

    const deny1 = await start("thief@example.com");
    expect(await run(null, `public.answer_old_email($1, false)`, [deny1])).toBe("denied");
    expect(await email(ACC)).toBe("new2@example.com");
    const lock = () => q2<{ denies: number; days: number }>(`(select jsonb_build_object('denies', denies, 'days', round(extract(epoch from locked_until - now()) / 86400)) from public.email_change_locks where user_id = $1)`, [ACC]);
    expect(await lock()).toEqual({ denies: 1, days: 10 });
    expect(await hint(ACC, `public.start_email_change('thief2@example.com')`)).toBe("locked");
    for (const [denies, days] of [[2, 20], [3, 40], [4, 80], [5, 160], [6, 160]] as const) {
      await db.query(`update public.email_change_locks set locked_until = null where user_id = $1`, [ACC]);
      await run(null, `public.answer_old_email($1, false)`, [await start(`try${denies}@example.com`)]);
      expect(await lock()).toEqual({ denies, days });
    }
  });

  it("skips the wait with two-factor, and lets the old address undo a change for 30 days", async () => {
    await db.query(`update public.email_change_locks set locked_until = null where user_id = $1`, [ACC]);
    // With two-factor on, has_mfa reads auth.mfa_factors, which the stand-in lacks: fake it.
    await db.query(`create table if not exists auth.mfa_factors (user_id uuid, status text)`);
    await db.query(`insert into auth.mfa_factors values ($1, 'verified')`, [ACC]);
    expect(await hint(ACC, `public.start_email_change('fast@example.com')`)).toBe("reauth"); // two-factor on, but this session is aal1
    await run(ACC, `public.start_email_change('fast@example.com')`, [], { aal: "aal2", amr: [{ method: "totp", timestamp: now() }] });
    expect(await run(null, `public.confirm_new_email($1)`, [(await mail("email-change-new"))!.data.token])).toBe("done");
    expect(await email(ACC)).toBe("fast@example.com");
    expect(await q2(`(select denies from public.email_change_locks where user_id = $1)`, [ACC])).toBe(0);

    const undo = (await mail("email-changed"))!.data.token;
    expect(await run(null, `public.email_change_view($1)`, [undo])).toMatchObject({ kind: "undo", status: "done" });
    await run(null, `public.undo_email_change($1)`, [undo]);
    expect(await hint(ACC, `public.start_email_change('again@example.com')`, [], { aal: "aal2", amr: [{ method: "totp", timestamp: now() }] })).toBe("frozen");
    const mfa = { aal: "aal2", amr: [{ method: "totp", timestamp: now() }] };
    const disputed = (await run<{ disputed: { id: number; username: string }[] }>(MODX, `public.mod_email_changes()`, [], mfa)).disputed;
    expect(disputed).toEqual([expect.objectContaining({ username: "acc_owner" })]);
    await run(MODX, `public.mod_settle_email_change(${disputed[0]!.id}, true, 'owner proved it')`, [], mfa);
    expect(await email(ACC)).toBe("new2@example.com");
    expect(await q2(`(select frozen from public.email_change_locks where user_id = $1)`, [ACC])).toBe(false);
    await db.query(`drop table auth.mfa_factors`);
  });
});

/** Runs a query as the database owner and returns its one value. */
const q2 = <T>(sql: string, params: unknown[] = []) => db.query<{ j: T }>(`select ${sql} as j`, params).then((r) => r.rows[0]!.j);

async function errorOfQuery(sql: string): Promise<string> {
  return db.query(sql).then(() => "no error", (e: Error) => e.message);
}
