-- M17, quick pairing (docs/v0.3-online-design.md, "Quick pairing", "Opponent filters" and
-- "Sportsmanship"): seeks on the six tiles, matched by find_match with a rating window that
-- widens while a player waits, "Play anyway" invitations for the nearest players outside it,
-- opponent filters applied both ways, and the sportsmanship record: labels on each game, the
-- completion rate, a warning, then pairing waits.

-- Sportsmanship ------------------------------------------------------------------------------

-- The labels the `game` function gives each side of a finished game (decide.ts): abandoned,
-- stalled, aborted, slow-start. The first three count against the completion rate.
alter table public.games add column labels jsonb not null default '{}';
-- When the player last acknowledged a sportsmanship warning.
alter table public.profiles add column sport_warned_at timestamptz;

drop function public.finish_game(uuid, text, text, text[], jsonb, jsonb, jsonb);

/**
 * Saves a finished game and, when rated, both players' new ratings (called by the `game`
 * server function after it replays the log), with the sportsmanship labels. Raises 'stale' if a
 * rating changed since it was read. Returns false if the game was already over.
 */
create function public.finish_game(p_game uuid, p_result text, p_reason text, p_moves text[], p_red jsonb, p_black jsonb, p_expected jsonb, p_labels jsonb default '{}')
returns boolean language plpgsql set search_path = '' as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game for update;
  if not found or g.status = 'over' then return false; end if;
  update public.games set status = 'over', result = p_result, reason = p_reason, moves = p_moves, ended_at = now(),
    labels = coalesce(p_labels, '{}'),
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

/** The player's side's labels in a game. */
create function public.labels_of(g public.games, p_user uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(g.labels->(case when g.red = p_user then 'red' else 'black' end), '[]'::jsonb)
$$;

/**
 * Completion rate (棋品): of the player's online games in the last 90 days, the per cent not
 * abandoned, stalled or aborted by them. Only their own actions lower it. Null under 5 games.
 */
create function public.completion_of(p_user uuid)
returns int language sql stable security definer set search_path = '' as $$
  select case when count(*) >= 5 then
    round(100.0 * count(*) filter (where not public.labels_of(g, p_user) ?| array['abandoned', 'stalled', 'aborted']) / count(*))::int end
  from public.games g
  where p_user in (g.red, g.black) and g.status = 'over' and g.started_at > now() - interval '90 days'
$$;

/**
 * A player's sportsmanship: completion rate, labels over their last 30 games, and the penalty,
 * if any. Faults are abandoning or stalling in the last 3 days, and frequent aborts (4 of the
 * last 10 games). The first fault since the last acknowledged warning brings a warning to
 * acknowledge; each fault after it within 3 days a pairing wait from that game's end (10 min,
 * doubling, at most a day), and matching with other players who do the same.
 */
create function public.sportsmanship_of(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  warned timestamptz := (select sport_warned_at from public.profiles where user_id = p_user);
  counts jsonb;
  faults timestamptz[];
  after timestamptz[];
  wait_until timestamptz;
begin
  select jsonb_build_object(
      'games', count(*),
      'abandoned', count(*) filter (where public.labels_of(g, p_user) ? 'abandoned'),
      'stalled', count(*) filter (where public.labels_of(g, p_user) ? 'stalled'),
      'aborted', count(*) filter (where public.labels_of(g, p_user) ? 'aborted'),
      'slow_start', count(*) filter (where public.labels_of(g, p_user) ? 'slow-start'))
    into counts
  from public.games g
  where g.id in (select x.id from public.games x where p_user in (x.red, x.black) and x.status = 'over' order by x.ended_at desc limit 30);

  select coalesce(array_agg(g.ended_at), '{}') into faults
  from public.games g
  where p_user in (g.red, g.black) and g.status = 'over' and g.ended_at > now() - interval '3 days'
    and public.labels_of(g, p_user) ?| array['abandoned', 'stalled'];
  -- Frequent aborts: the latest of them counts as one fault.
  if (select count(*) filter (where public.labels_of(g, p_user) ? 'aborted')
      from public.games g
      where g.id in (select x.id from public.games x where p_user in (x.red, x.black) and x.status = 'over' order by x.ended_at desc limit 10)) >= 4 then
    faults := faults || (select max(g.ended_at) from public.games g
                         where p_user in (g.red, g.black) and g.status = 'over' and public.labels_of(g, p_user) ? 'aborted'
                           and g.ended_at > now() - interval '3 days');
  end if;
  faults := array_remove(faults, null);
  after := array(select f from unnest(faults) f where warned is null or f > warned);

  if cardinality(after) > 0 and (warned is null or warned < now() - interval '3 days') then
    return jsonb_build_object('completion', public.completion_of(p_user), 'last30', counts, 'warning', true, 'wait_until', null, 'pool', false);
  end if;
  if cardinality(after) > 0 then
    wait_until := (select max(f) from unnest(after) f)
      + least(interval '24 hours', interval '10 minutes' * power(2, cardinality(after) - 1));
  end if;
  return jsonb_build_object(
    'completion', public.completion_of(p_user),
    'last30', counts,
    'warning', false,
    'wait_until', case when wait_until > now() then wait_until end,
    'pool', cardinality(after) > 0);
end $$;

/** The signed-in player's own sportsmanship record. */
create function public.my_sportsmanship()
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.sportsmanship_of(auth.uid())
$$;

/** Acknowledges the sportsmanship warning, so the player can seek again. */
create function public.acknowledge_sportsmanship()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set sport_warned_at = now() where user_id = auth.uid()
$$;

-- The public profile, as before, now with the completion rate.
create or replace function public.public_profile(p_username text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'username', p.username,
    'minimal', public.is_under16(p),
    'avatar', case when not public.is_under16(p) then p.avatar end,
    'country', case when not public.is_under16(p) then p.country end,
    'member_since', case when not public.is_under16(p) then p.created_at end,
    'ratings', coalesce((
      select jsonb_object_agg(r.kind, jsonb_build_object('rating', round(r.rating), 'rd', round(r.rd), 'games', r.games))
      from public.ratings r where r.user_id = p.user_id and r.kind in ('lightning', 'blitz', 'rapid')), '{}'::jsonb),
    'completion', public.completion_of(p.user_id),
    'checked_games', 0,
    'violation', null,
    'blocked', exists (select 1 from public.blocks b where b.user_id = auth.uid() and b.blocked_id = p.user_id),
    'me', p.user_id = auth.uid()
  )
  from public.profiles p where lower(p.username) = lower(p_username)
$$;

-- Seeks ---------------------------------------------------------------------------------------

-- A player looking for a game on a tile, with what matching needs to know about them, taken
-- when they start: rating at that speed, their filters, and what other players' filters ask.
create table public.seeks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  base int not null,
  inc int not null,
  speed text not null,
  rating int not null,
  -- Still settling (uncertainty over 110, shown with "?"): the window starts at ±150.
  provisional boolean not null,
  -- Rated games at this speed; "established" opponents have at least 10.
  games int not null,
  -- The player's filters: rating range (null: any), established only, minimum account age in
  -- days, minimum completion rate in per cent.
  max_diff int,
  established_only boolean not null,
  min_account_days int not null,
  min_completion int not null,
  -- What other players' filters look at.
  account_created timestamptz not null,
  completion int,
  relay boolean not null,
  -- Under the sportsmanship penalty: matched only with others under it.
  pool boolean not null,
  -- Widened to anyone after 30 s: only the rating-range filter still limits the window.
  anyone boolean not null default false,
  created_at timestamptz not null default now(),
  -- The browser asks every few seconds; a seek not asked about for 10 s isn't matched.
  seen_at timestamptz not null default now(),
  game_id uuid references public.games (id) on delete set null
);
alter table public.seeks enable row level security;
revoke all on public.seeks from anon, authenticated;

-- "Play anyway": an invitation to a seeker outside the rating window, open for 15 s.
create table public.seek_invites (
  id bigint generated always as identity primary key,
  from_user uuid not null unique references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.seek_invites enable row level security;
revoke all on public.seek_invites from anon, authenticated;

/** The six quick-pair tiles (TILES in @xq/online). */
create function public.is_tile(p_base int, p_inc int)
returns boolean language sql immutable set search_path = '' as $$
  select (p_base, p_inc) in ((120, 1), (60, 2), (300, 3), (180, 2), (600, 5), (900, 10))
$$;

/**
 * How far from their rating a seeker accepts an opponent now, or null for no limit: ±50 (±150
 * while provisional), widening by 25 every 5 s up to ±200; after "anyone", only their filter.
 */
create function public.seek_window(s public.seeks)
returns int language sql stable set search_path = '' as $$
  select case when s.anyone then s.max_diff
    else least(coalesce(s.max_diff, 200), 200,
               (case when s.provisional then 150 else 50 end) + 25 * floor(extract(epoch from now() - s.created_at) / 5)::int) end
$$;

/** Whether `a`'s filters, other than the rating range, accept `b`. */
create function public.seek_filters(a public.seeks, b public.seeks)
returns boolean language sql stable set search_path = '' as $$
  select (not a.established_only or b.games >= 10)
    and b.account_created <= now() - make_interval(days => a.min_account_days)
    and (a.min_completion = 0 or b.completion is null or b.completion >= a.min_completion)
$$;

/** Whether `b` could play `a` at all: a live seek on the same tile, in the same pool, no block, both filters. */
create function public.seek_fits(a public.seeks, b public.seeks)
returns boolean language sql stable security definer set search_path = '' as $$
  select b.user_id <> a.user_id and b.game_id is null and b.seen_at > now() - interval '10 seconds'
    and b.base = a.base and b.inc = a.inc and b.pool = a.pool
    and not exists (select 1 from public.blocks k where (k.user_id = a.user_id and k.blocked_id = b.user_id) or (k.user_id = b.user_id and k.blocked_id = a.user_id))
    and public.seek_filters(a, b) and public.seek_filters(b, a)
$$;

/** Whether the rating gap is inside both seekers' windows. */
create function public.seek_in_window(a public.seeks, b public.seeks)
returns boolean language sql stable set search_path = '' as $$
  select (public.seek_window(a) is null or abs(a.rating - b.rating) <= public.seek_window(a))
    and (public.seek_window(b) is null or abs(a.rating - b.rating) <= public.seek_window(b))
$$;

/**
 * Starts a rated game between two seekers and marks both seeks. Colours: whoever had Red more
 * often in their last 10 games gets Black (random if equal). Relayed if either asked, or a
 * player is under 16.
 */
create function public.pair_seeks(a public.seeks, b public.seeks)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  reds_a int;
  reds_b int;
  red uuid;
  black uuid;
  game uuid;
begin
  select coalesce(sum(case when x.red = a.user_id then 1 else -1 end), 0) into reds_a
  from (select g.red from public.games g where a.user_id in (g.red, g.black) order by g.started_at desc limit 10) x;
  select coalesce(sum(case when x.red = b.user_id then 1 else -1 end), 0) into reds_b
  from (select g.red from public.games g where b.user_id in (g.red, g.black) order by g.started_at desc limit 10) x;
  if reds_a < reds_b or (reds_a = reds_b and random() < 0.5) then
    red := a.user_id; black := b.user_id;
  else
    red := b.user_id; black := a.user_id;
  end if;
  insert into public.games (red, black, base, inc, speed, rated, relay)
  values (red, black, a.base, a.inc, a.speed, true,
          a.relay or b.relay or exists (select 1 from public.profiles p where p.user_id in (red, black) and public.is_under16(p)))
  returning id into game;
  update public.seeks set game_id = game where user_id in (a.user_id, b.user_id);
  delete from public.seek_invites where from_user in (a.user_id, b.user_id) or to_user in (a.user_id, b.user_id);
  return game;
end $$;

/**
 * Starts seeking on a tile (replacing any earlier seek). p_filters: range (100–400, or null for
 * any), established (boolean), account_age (0, 7 or 30), completion (0, 90 or 95). Raises 'not
 * ready' before the online-play check is passed, and 'sportsmanship' (hint 'warning', or the
 * time the wait ends) under a penalty.
 */
create function public.seek(p_base int, p_inc int, p_filters jsonb, p_relay boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  sport jsonb;
  r public.ratings;
  speed text := public.speed_of(p_base, p_inc);
  range int := (p_filters->>'range')::int;
  days int := coalesce((p_filters->>'account_age')::int, 0);
  completion int := coalesce((p_filters->>'completion')::int, 0);
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not public.is_tile(p_base, p_inc) then raise exception 'not a tile' using errcode = '22023'; end if;
  if range not in (100, 200, 300, 400) or days not in (0, 7, 30) or completion not in (0, 90, 95) then
    raise exception 'bad filters' using errcode = '22023';
  end if;
  if not coalesce((public.online_eligibility()->>'eligible')::boolean, false) then
    raise exception 'not ready for online play' using errcode = '42501';
  end if;
  sport := public.sportsmanship_of(me);
  if (sport->>'warning')::boolean then
    raise exception 'sportsmanship' using errcode = 'P0001', hint = 'warning';
  end if;
  if sport->>'wait_until' is not null then
    raise exception 'sportsmanship' using errcode = 'P0001', hint = sport->>'wait_until';
  end if;
  perform pg_advisory_xact_lock(1717);
  r := public.speed_rating(me, speed);
  insert into public.seeks (user_id, base, inc, speed, rating, provisional, games, max_diff, established_only, min_account_days,
                            min_completion, account_created, completion, relay, pool)
  select me, p_base, p_inc, speed, round(r.rating), r.rd > 110, r.games, range, coalesce((p_filters->>'established')::boolean, false),
         days, completion, u.created_at, public.completion_of(me), coalesce(p_relay, false), (sport->>'pool')::boolean
  from auth.users u where u.id = me
  on conflict (user_id) do update set base = excluded.base, inc = excluded.inc, speed = excluded.speed, rating = excluded.rating,
    provisional = excluded.provisional, games = excluded.games, max_diff = excluded.max_diff, established_only = excluded.established_only,
    min_account_days = excluded.min_account_days, min_completion = excluded.min_completion, completion = excluded.completion,
    relay = excluded.relay, pool = excluded.pool, anyone = false, created_at = now(), seen_at = now(), game_id = null;
  delete from public.seek_invites where from_user = me;
end $$;

/**
 * Called every few seconds while seeking: pairs the player with the nearest-rated seeker both
 * windows and both sets of filters allow (the longest waiting among equals), in one step that
 * takes both out of the queue. Returns {status: 'matched', game}, or {status: 'searching'} with
 * the window, the nearest players outside it (for "Play anyway"), an invitation to the player
 * if there is one, and how many players are seeking on each tile; or {status: 'idle'}.
 */
create function public.find_match()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  s public.seeks;
  o public.seeks;
  game uuid;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(1717);
  select * into s from public.seeks where user_id = me;
  if not found then return jsonb_build_object('status', 'idle'); end if;
  if s.game_id is not null then
    delete from public.seeks where user_id = me;
    return jsonb_build_object('status', 'matched', 'game', s.game_id);
  end if;
  update public.seeks set seen_at = now() where user_id = me returning * into s;

  select * into o from public.seeks x
  where public.seek_fits(s, x) and public.seek_in_window(s, x)
  order by abs(x.rating - s.rating), x.created_at limit 1;
  if found then
    game := public.pair_seeks(s, o);
    delete from public.seeks where user_id = me;
    return jsonb_build_object('status', 'matched', 'game', game);
  end if;

  return jsonb_build_object(
    'status', 'searching',
    'window', public.seek_window(s),
    'anyone', s.anyone,
    'waited', floor(extract(epoch from now() - s.created_at))::int,
    'nearest', coalesce((
      select jsonb_agg(n order by n.gap) from (
        select p.username, x.rating, abs(x.rating - s.rating) as gap, x.rating - s.rating as diff,
          floor(extract(epoch from now() - x.created_at))::int as waited,
          exists (select 1 from public.seek_invites i where i.from_user = me and i.to_user = x.user_id and i.created_at > now() - interval '15 seconds') as invited
        from public.seeks x join public.profiles p on p.user_id = x.user_id
        where public.seek_fits(s, x) and not public.seek_in_window(s, x)
        order by abs(x.rating - s.rating) limit 3) n), '[]'::jsonb),
    'invite', (
      select jsonb_build_object('id', i.id, 'rating', x.rating, 'diff', x.rating - s.rating,
        'expires_in', ceil(15 - extract(epoch from now() - i.created_at))::int)
      from public.seek_invites i join public.seeks x on x.user_id = i.from_user
      where i.to_user = me and i.created_at > now() - interval '15 seconds' and public.seek_fits(s, x)
      order by i.created_at desc limit 1),
    'counts', public.seek_counts());
end $$;

/** "Play anyway": invites a seeker outside the rating window. False if they're no longer there. */
create function public.invite_seeker(p_username text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  s public.seeks;
  o public.seeks;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(1717);
  select * into s from public.seeks where user_id = me and game_id is null;
  if not found then return false; end if;
  select x.* into o from public.seeks x join public.profiles p on p.user_id = x.user_id where lower(p.username) = lower(p_username);
  if not found or not public.seek_fits(s, o) then return false; end if;
  insert into public.seek_invites (from_user, to_user) values (me, o.user_id)
  on conflict (from_user) do update set to_user = excluded.to_user, created_at = now();
  return true;
end $$;

/**
 * Accepts or declines an invitation. Accepting starts the game if both are still seeking and
 * free (returns its id); otherwise null ("No longer available"), and the search goes on.
 */
create function public.answer_invite(p_id bigint, p_accept boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  i public.seek_invites;
  s public.seeks;
  o public.seeks;
  game uuid;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(1717);
  select * into i from public.seek_invites where id = p_id and to_user = me;
  if not found then return null; end if;
  delete from public.seek_invites where id = p_id;
  if not p_accept or i.created_at < now() - interval '15 seconds' then return null; end if;
  select * into s from public.seeks where user_id = me and game_id is null;
  select * into o from public.seeks where user_id = i.from_user;
  if s.user_id is null or o.user_id is null or not public.seek_fits(s, o) then return null; end if;
  game := public.pair_seeks(s, o);
  delete from public.seeks where user_id = me;
  return game;
end $$;

/** Opens the window to anyone (after 30 s): only the player's rating-range filter still limits it. */
create function public.widen_seek()
returns void language sql security definer set search_path = '' as $$
  update public.seeks set anyone = true where user_id = auth.uid() and game_id is null
$$;

/** Stops seeking. A seek already matched stays, so find_match still hands over the game. */
create function public.cancel_seek()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(1717);
  delete from public.seeks where user_id = auth.uid() and game_id is null;
  delete from public.seek_invites where from_user = auth.uid();
end $$;

/** How many players are seeking on each tile now, keyed "base+inc" in seconds ("300+3"). */
create function public.seek_counts()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
    select s.base || '+' || s.inc as k, count(*) as n from public.seeks s
    where s.game_id is null and s.seen_at > now() - interval '10 seconds' group by s.base, s.inc) c
$$;

/** Clears seeks and invitations nobody has asked about for a minute (run by pg_cron). */
create function public.clear_seeks()
returns void language sql security definer set search_path = '' as $$
  delete from public.seeks where seen_at < now() - interval '1 minute';
  delete from public.seek_invites where created_at < now() - interval '1 minute';
$$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('clear-seeks', '* * * * *', 'select public.clear_seeks()');
  end if;
end $$;

-- Access ----------------------------------------------------------------------------------

revoke all on function public.finish_game(uuid, text, text, text[], jsonb, jsonb, jsonb, jsonb), public.labels_of(public.games, uuid),
  public.completion_of(uuid), public.sportsmanship_of(uuid), public.my_sportsmanship(), public.acknowledge_sportsmanship(),
  public.is_tile(int, int), public.seek_window(public.seeks), public.seek_filters(public.seeks, public.seeks),
  public.seek_fits(public.seeks, public.seeks), public.seek_in_window(public.seeks, public.seeks), public.pair_seeks(public.seeks, public.seeks),
  public.seek(int, int, jsonb, boolean), public.find_match(), public.invite_seeker(text), public.answer_invite(bigint, boolean),
  public.widen_seek(), public.cancel_seek(), public.seek_counts(), public.clear_seeks()
  from public, anon, authenticated;
grant execute on function public.my_sportsmanship(), public.acknowledge_sportsmanship(), public.seek(int, int, jsonb, boolean),
  public.find_match(), public.invite_seeker(text), public.answer_invite(bigint, boolean), public.widen_seek(), public.cancel_seek(),
  public.seek_counts() to authenticated;
grant execute on function public.seek_counts() to anon;
grant execute on function public.finish_game(uuid, text, text, text[], jsonb, jsonb, jsonb, jsonb), public.clear_seeks() to service_role;
