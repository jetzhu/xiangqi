-- M20, from the load test on staging (docs/v0.3-online-design.md, "Free-plan budget"): quick
-- pairing ran every call behind one lock, and at about 33 calls a second (some 80 players
-- searching at once) the lock was busy all the time and searches queued for seconds. Now each
-- call locks only its own seek and the one it pairs with (skipping any another call holds), and
-- narrows to live seeks on the same tile, with an index, before the costlier checks.

create index seeks_live_idx on public.seeks (base, inc, seen_at) where game_id is null;

-- Plain SQL, so the planner can fold it into the queries that use it (all inside functions
-- that already run with the owner's rights).
create or replace function public.seek_fits(a public.seeks, b public.seeks)
returns boolean language sql stable set search_path = '' as $$
  select b.user_id <> a.user_id and b.game_id is null and b.seen_at > now() - interval '10 seconds'
    and b.base = a.base and b.inc = a.inc and b.pool = a.pool and b.quiet = a.quiet
    and not exists (select 1 from public.blocks k where (k.user_id = a.user_id and k.blocked_id = b.user_id) or (k.user_id = b.user_id and k.blocked_id = a.user_id))
    and public.seek_filters(a, b) and public.seek_filters(b, a)
$$;

/**
 * As in M17, without the global lock: the player's own seek is locked, and the nearest fitting
 * seek is taken with SKIP LOCKED, so two calls never pair the same player and never wait on
 * each other. Two players reaching for each other at the same instant both skip, and pair on
 * the next poll.
 */
create or replace function public.find_match()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  s public.seeks;
  o public.seeks;
  game uuid;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into s from public.seeks where user_id = me for update;
  if not found then return jsonb_build_object('status', 'idle'); end if;
  if s.game_id is not null then
    delete from public.seeks where user_id = me;
    return jsonb_build_object('status', 'matched', 'game', s.game_id);
  end if;
  update public.seeks set seen_at = now() where user_id = me returning * into s;

  select x.* into o from public.seeks x
  where x.base = s.base and x.inc = s.inc and x.game_id is null and x.seen_at > now() - interval '10 seconds' and x.user_id <> me
    and public.seek_fits(s, x) and public.seek_in_window(s, x)
  order by abs(x.rating - s.rating), x.created_at
  limit 1 for update skip locked;
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
        where x.base = s.base and x.inc = s.inc and x.game_id is null and x.seen_at > now() - interval '10 seconds' and x.user_id <> me
          and public.seek_fits(s, x) and not public.seek_in_window(s, x)
        order by abs(x.rating - s.rating) limit 3) n), '[]'::jsonb),
    'invite', (
      select jsonb_build_object('id', i.id, 'rating', x.rating, 'diff', x.rating - s.rating,
        'expires_in', ceil(15 - extract(epoch from now() - i.created_at))::int)
      from public.seek_invites i join public.seeks x on x.user_id = i.from_user
      where i.to_user = me and i.created_at > now() - interval '15 seconds' and public.seek_fits(s, x)
      order by i.created_at desc limit 1),
    'counts', public.seek_counts());
end $$;

/** As in M17, without the global lock. */
create or replace function public.invite_seeker(p_username text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  s public.seeks;
  o public.seeks;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into s from public.seeks where user_id = me and game_id is null;
  if not found then return false; end if;
  select x.* into o from public.seeks x join public.profiles p on p.user_id = x.user_id where lower(p.username) = lower(p_username);
  if not found or not public.seek_fits(s, o) then return false; end if;
  insert into public.seek_invites (from_user, to_user) values (me, o.user_id)
  on conflict (from_user) do update set to_user = excluded.to_user, created_at = now();
  return true;
end $$;

/** As in M17, without the global lock: if the inviter's seek is busy being paired, the invitation is no longer available. */
create or replace function public.answer_invite(p_id bigint, p_accept boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  i public.seek_invites;
  s public.seeks;
  o public.seeks;
  game uuid;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into i from public.seek_invites where id = p_id and to_user = me;
  if not found then return null; end if;
  delete from public.seek_invites where id = p_id;
  if not p_accept or i.created_at < now() - interval '15 seconds' then return null; end if;
  select * into s from public.seeks where user_id = me and game_id is null for update;
  if not found then return null; end if;
  select * into o from public.seeks where user_id = i.from_user and game_id is null for update skip locked;
  if not found or not public.seek_fits(s, o) then return null; end if;
  game := public.pair_seeks(s, o);
  delete from public.seeks where user_id = me;
  return game;
end $$;

/** As in M17, without the global lock. A seek already matched stays, so find_match hands over the game. */
create or replace function public.cancel_seek()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.seeks where user_id = auth.uid() and game_id is null;
  delete from public.seek_invites where from_user = auth.uid();
end $$;

/**
 * As in M18, without the global lock. A seek that was matched meanwhile isn't replaced, so a
 * new search can't wipe out a game just found: find_match hands it over.
 */
create or replace function public.seek(p_base int, p_inc int, p_filters jsonb, p_relay boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  sport jsonb;
  r public.ratings;
  speed text := public.speed_of(p_base, p_inc);
  range int := (p_filters->>'range')::int;
  days int := coalesce((p_filters->>'account_age')::int, 0);
  completion int := coalesce((p_filters->>'completion')::int, 0);
  likely boolean;
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
  r := public.speed_rating(me, speed);
  likely := exists (select 1 from public.fairplay f where f.user_id = me and f.speed = public.speed_of(p_base, p_inc) and f.verdict = 'likely');
  insert into public.seeks (user_id, base, inc, speed, rating, provisional, games, max_diff, established_only, min_account_days,
                            min_completion, account_created, completion, relay, pool, checked, finding, checked_only, quiet)
  select me, p_base, p_inc, speed, round(r.rating), r.rd > 110, r.games, range, coalesce((p_filters->>'established')::boolean, false),
         days, completion, u.created_at, public.completion_of(me), coalesce(p_relay, false), (sport->>'pool')::boolean,
         public.checked_games_of(me), exists (select 1 from public.fairplay f where f.user_id = me and f.verdict = 'likely'),
         coalesce((p_filters->>'checked')::boolean, false), likely
  from auth.users u where u.id = me
  on conflict (user_id) do update set base = excluded.base, inc = excluded.inc, speed = excluded.speed, rating = excluded.rating,
    provisional = excluded.provisional, games = excluded.games, max_diff = excluded.max_diff, established_only = excluded.established_only,
    min_account_days = excluded.min_account_days, min_completion = excluded.min_completion, completion = excluded.completion,
    relay = excluded.relay, pool = excluded.pool, checked = excluded.checked, finding = excluded.finding,
    checked_only = excluded.checked_only, quiet = excluded.quiet,
    anyone = false, created_at = now(), seen_at = now(), game_id = null
  where public.seeks.game_id is null;
  delete from public.seek_invites where from_user = me;
end $$;
