-- M16, play a friend (docs/v0.3-online-design.md, "Architecture"): challenge links, games,
-- the queue the browsers report each move to, the worker that writes the game log from it, and
-- the private Realtime channel the two browsers use to set up their direct link (or as the
-- relay). The browsers play the game; the server keeps the record. The `game` server function
-- (packages/online/src/server) replays a finished game from the log and rates it.

-- Challenges ------------------------------------------------------------------------------

create table public.challenges (
  code text primary key,
  from_user uuid not null references auth.users (id) on delete cascade,
  base int not null check (base between 60 and 3600 and base % 60 = 0),
  inc int not null check (inc between 0 and 30),
  color text not null check (color in ('red', 'black', 'random')),
  rated boolean not null,
  -- The challenger asked for the relay ("Don't share my network address").
  relay boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 day',
  game_id uuid
);
create index challenges_from_idx on public.challenges (from_user, created_at desc);
alter table public.challenges enable row level security;
revoke all on public.challenges from anon, authenticated;

-- Games -----------------------------------------------------------------------------------

create table public.games (
  id uuid primary key default gen_random_uuid(),
  -- Null once that player's account is deleted; the game stays in the other's history.
  red uuid references auth.users (id) on delete set null,
  black uuid references auth.users (id) on delete set null,
  base int not null,
  inc int not null,
  speed text not null check (speed in ('lightning', 'blitz', 'rapid')),
  rated boolean not null,
  -- Played through the relay: a player is under 16 or asked not to share their network address.
  relay boolean not null,
  status text not null default 'playing' check (status in ('playing', 'over')),
  -- 'none': aborted, or no result.
  result text check (result in ('red', 'black', 'draw', 'none')),
  reason text,
  moves text[] not null default '{}',
  red_rating_before int,
  red_rating_after int,
  black_rating_before int,
  black_rating_after int,
  -- Each browser's own end report (result, moves, clocks), as the worker found it.
  red_end jsonb,
  black_end jsonb,
  started_at timestamptz not null default now(),
  -- When the last report arrived: a game nobody reports on for long is ended by the worker.
  last_report_at timestamptz not null default now(),
  ended_at timestamptz,
  check (red is distinct from black)
);
create index games_red_idx on public.games (red, started_at desc);
create index games_black_idx on public.games (black, started_at desc);
create index games_playing_idx on public.games (last_report_at) where status = 'playing';
alter table public.games enable row level security;
revoke all on public.games from anon, authenticated;
-- Players read their own games (the history list); everything is written by functions.
create policy "players read their games" on public.games for select to authenticated
  using ((select auth.uid()) in (red, black));
grant select on public.games to authenticated;

-- The server's own timeline of each game: one row per report, stamped when it reached the queue.
create table public.game_log (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  by_color text not null check (by_color in ('red', 'black')),
  kind text not null check (kind in ('move', 'away', 'back', 'end')),
  ply int,
  report jsonb not null,
  at timestamptz not null
);
create index game_log_game_idx on public.game_log (game_id, id);
alter table public.game_log enable row level security;
revoke all on public.game_log from anon, authenticated;

/** The colour the signed-in player has in a game, or null if they're not in it. */
create function public.my_color(p_game uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when g.red = auth.uid() then 'red' when g.black = auth.uid() then 'black' end
  from public.games g where g.id = p_game
$$;

/** A player's rating at a speed, creating it from their bot rating (800 without one) if new. */
create function public.speed_rating(p_user uuid, p_speed text)
returns public.ratings language plpgsql security definer set search_path = '' as $$
declare
  r public.ratings;
begin
  select * into r from public.ratings where user_id = p_user and kind = p_speed;
  if found then return r; end if;
  insert into public.ratings (user_id, kind, rating, rd, games)
  values (p_user, p_speed, coalesce((select b.rating from public.ratings b where b.user_id = p_user and b.kind = 'bot'), 800), 200, 0)
  on conflict (user_id, kind) do nothing;
  select * into r from public.ratings where user_id = p_user and kind = p_speed;
  return r;
end $$;

create function public.speed_of(p_base int, p_inc int)
returns text language sql immutable set search_path = '' as $$
  select case when p_base + 40 * p_inc < 180 then 'lightning' when p_base + 40 * p_inc < 600 then 'blitz' else 'rapid' end
$$;

/**
 * Creates a challenge link: time control, colour (red, black or random), rated or casual.
 * Needs the online-play check passed (decision D9). Returns the code; a player has at most 3
 * open challenges, so the oldest goes.
 */
create function public.create_challenge(p_base int, p_inc int, p_color text, p_rated boolean, p_relay boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  new_code text;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not coalesce((public.online_eligibility()->>'eligible')::boolean, false) then
    raise exception 'not ready for online play' using errcode = '42501';
  end if;
  delete from public.challenges c where c.from_user = me and c.game_id is null
    and c.code not in (select c2.code from public.challenges c2 where c2.from_user = me and c2.game_id is null
                       order by c2.created_at desc limit 2);
  -- 6 characters without look-alikes (0/O, 1/I/L), easy to read out.
  loop
    new_code := (select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from public.challenges c where c.code = new_code);
  end loop;
  insert into public.challenges (code, from_user, base, inc, color, rated, relay)
  values (new_code, me, p_base, p_inc, p_color, p_rated, coalesce(p_relay, false));
  return new_code;
end $$;

/** What a challenge link shows: who, the time control, colour, rated, and its game once accepted. */
create function public.challenge_info(p_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'code', c.code,
    'from', p.username,
    'mine', coalesce(c.from_user = auth.uid(), false),
    'rating', (select round(r.rating) from public.ratings r where r.user_id = c.from_user and r.kind = public.speed_of(c.base, c.inc)),
    'base', c.base, 'inc', c.inc, 'color', c.color, 'rated', c.rated,
    'expired', c.expires_at < now(),
    -- Only the two players learn the game.
    'game', case when c.from_user = auth.uid() or (g.red = auth.uid() or g.black = auth.uid()) then c.game_id end,
    'taken', c.game_id is not null
  )
  from public.challenges c join public.profiles p on p.user_id = c.from_user
  left join public.games g on g.id = c.game_id
  where c.code = upper(p_code)
$$;

/** Withdraws one of my open challenges. */
create function public.cancel_challenge(p_code text)
returns void language sql security definer set search_path = '' as $$
  delete from public.challenges where code = upper(p_code) and from_user = auth.uid() and game_id is null
$$;

/**
 * Accepts a challenge and starts the game. Returns the game id. Refused if the link has expired
 * or been taken, it's the player's own, either player has blocked the other, or the player
 * hasn't passed the online-play check.
 */
create function public.accept_challenge(p_code text, p_relay boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.challenges;
  red uuid;
  black uuid;
  relay boolean;
  game uuid;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into c from public.challenges where code = upper(p_code) for update;
  if not found or c.expires_at < now() then raise exception 'challenge not found' using errcode = 'P0002'; end if;
  if c.game_id is not null then raise exception 'challenge already taken' using errcode = '55000'; end if;
  if c.from_user = me then raise exception 'your own challenge' using errcode = '22023'; end if;
  if exists (select 1 from public.blocks b where (b.user_id = me and b.blocked_id = c.from_user) or (b.user_id = c.from_user and b.blocked_id = me)) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  if not coalesce((public.online_eligibility()->>'eligible')::boolean, false) then
    raise exception 'not ready for online play' using errcode = '42501';
  end if;
  if c.color = 'red' or (c.color = 'random' and random() < 0.5) then
    red := c.from_user; black := me;
  else
    red := me; black := c.from_user;
  end if;
  relay := c.relay or coalesce(p_relay, false)
    or exists (select 1 from public.profiles p where p.user_id in (red, black) and p.under16 is not false);
  insert into public.games (red, black, base, inc, speed, rated, relay)
  values (red, black, c.base, c.inc, public.speed_of(c.base, c.inc), c.rated, relay)
  returning id into game;
  update public.challenges set game_id = game where code = c.code;
  perform public.speed_rating(red, public.speed_of(c.base, c.inc));
  perform public.speed_rating(black, public.speed_of(c.base, c.inc));
  return game;
end $$;

/** A game as its players see it: names, ratings, time control, and the result once over. */
create function public.game_info(p_game uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', g.id,
    'me', public.my_color(g.id),
    'red', jsonb_build_object('username', pr.username, 'avatar', pr.avatar, 'rating', round(rr.rating), 'rd', round(rr.rd)),
    'black', jsonb_build_object('username', pb.username, 'avatar', pb.avatar, 'rating', round(rb.rating), 'rd', round(rb.rd)),
    'base', g.base, 'inc', g.inc, 'speed', g.speed, 'rated', g.rated, 'relay', g.relay,
    'status', g.status, 'result', g.result, 'reason', g.reason, 'moves', to_jsonb(g.moves),
    'red_rating_before', g.red_rating_before, 'red_rating_after', g.red_rating_after,
    'black_rating_before', g.black_rating_before, 'black_rating_after', g.black_rating_after,
    'started_at', g.started_at, 'ended_at', g.ended_at
  )
  from public.games g
  left join public.profiles pr on pr.user_id = g.red
  left join public.profiles pb on pb.user_id = g.black
  left join public.ratings rr on rr.user_id = g.red and rr.kind = g.speed
  left join public.ratings rb on rb.user_id = g.black and rb.kind = g.speed
  where g.id = p_game and auth.uid() in (g.red, g.black)
$$;

-- Reports, through the queue ------------------------------------------------------------

-- Supabase Queues (pgmq) is on every plan; the tests' in-memory Postgres has a stand-in.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pgmq') then
    create extension if not exists pgmq;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'pgmq') then
    perform pgmq.create('game_reports');
  end if;
end $$;

/**
 * A browser's report on its game (packages/online, `Report`): a move, the opponent gone quiet
 * or back, or the end. One quick insert into the queue; the time it arrives is the server's
 * own record of when it happened.
 */
create function public.report_game(p_game uuid, p_report jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  color text := public.my_color(p_game);
begin
  if color is null then raise exception 'not your game' using errcode = '42501'; end if;
  if p_report->>'kind' not in ('move', 'away', 'back', 'end') or length(p_report::text) > 20000 then
    raise exception 'bad report' using errcode = '22023';
  end if;
  perform pgmq.send('game_reports', jsonb_build_object('game', p_game, 'by', color, 'at', clock_timestamp(), 'report', p_report));
end $$;

/**
 * The queue worker: moves reports into the game log, keeps each browser's end report, and
 * ends games nobody has reported on for 10 minutes, unrated: aborted before the first moves;
 * a draw if both players went without a word; no result if an ending was claimed that the
 * `game` function couldn't settle. Run every few seconds by pg_cron, and by the `game`
 * function before it reads a log. Returns how many reports it handled.
 */
create function public.process_game_reports(p_batch int default 200)
returns int language plpgsql security definer set search_path = '' as $$
declare
  m record;
  n int := 0;
  r jsonb;
  g uuid;
begin
  for m in select * from pgmq.read('game_reports', 30, p_batch) loop
    r := m.message->'report';
    g := (m.message->>'game')::uuid;
    insert into public.game_log (game_id, by_color, kind, ply, report, at)
    select g, m.message->>'by', r->>'kind', (r->>'ply')::int, r, (m.message->>'at')::timestamptz
    where exists (select 1 from public.games where id = g);
    update public.games set
      last_report_at = greatest(last_report_at, (m.message->>'at')::timestamptz),
      red_end = case when r->>'kind' = 'end' and m.message->>'by' = 'red' then r else red_end end,
      black_end = case when r->>'kind' = 'end' and m.message->>'by' = 'black' then r else black_end end
    where id = g;
    perform pgmq.archive('game_reports', m.msg_id);
    n := n + 1;
  end loop;

  update public.games g set status = 'over', ended_at = now(),
    result = case when g.red_end is null and g.black_end is null and moved.n >= 2 then 'draw' else 'none' end,
    reason = case when g.red_end is not null or g.black_end is not null then 'no-result' when moved.n < 2 then 'aborted' else 'both-away' end
  from (select g2.id, (select count(distinct l.ply) from public.game_log l where l.game_id = g2.id and l.kind = 'move') as n
        from public.games g2 where g2.status = 'playing' and g2.last_report_at < now() - interval '10 minutes') moved
  where g.id = moved.id;
  return n;
end $$;

/**
 * Saves a finished game and, when rated, both players' new ratings (called by the `game`
 * server function after it replays the log). Raises 'stale' if a rating changed since it was
 * read. Returns false if the game was already over.
 */
create function public.finish_game(p_game uuid, p_result text, p_reason text, p_moves text[], p_red jsonb, p_black jsonb, p_expected jsonb)
returns boolean language plpgsql set search_path = '' as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game for update;
  if not found or g.status = 'over' then return false; end if;
  update public.games set status = 'over', result = p_result, reason = p_reason, moves = p_moves, ended_at = now(),
    red_rating_before = (p_red->>'before')::int, red_rating_after = (p_red->>'rating')::int,
    black_rating_before = (p_black->>'before')::int, black_rating_after = (p_black->>'rating')::int
  where id = p_game;
  if jsonb_typeof(p_red) = 'object' and g.red is not null then
    perform public.save_rating(g.red, g.speed, p_red, (p_expected->>'red')::int);
  end if;
  if jsonb_typeof(p_black) = 'object' and g.black is not null then
    perform public.save_rating(g.black, g.speed, p_black, (p_expected->>'black')::int);
  end if;
  return true;
end $$;

-- Every 5 seconds, where pg_cron is installed (Supabase; not the tests' in-memory Postgres).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('process-game-reports', '5 seconds', 'select public.process_game_reports()');
  end if;
end $$;

-- The private channel for each game ---------------------------------------------------------

-- The two browsers set up their direct link, or relay the game, over the Realtime channel
-- "game:<id>", private to its two players. Supabase checks these policies on realtime.messages
-- (the tests' Postgres has no Realtime).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'realtime') then
    execute $p$
      create policy "game players receive" on realtime.messages for select to authenticated
      using (realtime.topic() like 'game:%' and public.my_color(substr(realtime.topic(), 6)::uuid) is not null)
    $p$;
    execute $p$
      create policy "game players send" on realtime.messages for insert to authenticated
      with check (realtime.topic() like 'game:%' and public.my_color(substr(realtime.topic(), 6)::uuid) is not null)
    $p$;
  end if;
end $$;

-- Access ----------------------------------------------------------------------------------

revoke all on function public.my_color(uuid), public.speed_rating(uuid, text), public.speed_of(int, int),
  public.create_challenge(int, int, text, boolean, boolean), public.challenge_info(text), public.cancel_challenge(text),
  public.accept_challenge(text, boolean), public.game_info(uuid), public.report_game(uuid, jsonb),
  public.process_game_reports(int), public.finish_game(uuid, text, text, text[], jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_challenge(int, int, text, boolean, boolean), public.challenge_info(text),
  public.cancel_challenge(text), public.accept_challenge(text, boolean), public.game_info(uuid),
  public.report_game(uuid, jsonb), public.my_color(uuid) to authenticated;
-- A challenge link opened while signed out still says who it's from.
grant execute on function public.challenge_info(text) to anon;
grant execute on function public.process_game_reports(int), public.finish_game(uuid, text, text, text[], jsonb, jsonb, jsonb) to service_role;
