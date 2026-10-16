-- M18, fair-play data (docs/v0.3-online-design.md, "Fair play"): both browsers' analyses of each
-- rated game, the game's check once they agree (scored by the `game` function), baselines of
-- honest players by rating and speed, each player's standing from their recent games, checked-
-- game counts on profiles, the "fair-play checked" opponent filter, and quiet separate matching
-- for players whose standing is "likely". Nothing here is public except the checked-game count.

-- The tunable numbers. The code is public, so the starting values below are too; the site
-- owner can change them later with an update that isn't published.
create table public.fairplay_config (
  key text primary key,
  value numeric not null
);
alter table public.fairplay_config enable row level security;
revoke all on public.fairplay_config from anon, authenticated;
insert into public.fairplay_config (key, value) values
  -- A player's standing: Stouffer's combination of their last games' scores (Regan's threshold
  -- for statistics alone is about 5 standard deviations), and several games far out of line.
  ('recent_games', 20), ('min_plies', 36), ('min_games', 10), ('min_games_lightning', 15),
  ('watch_z', 3), ('likely_z', 5), ('far_z', 2.5), ('far_games', 3),
  -- Each timing or focus flag adds this to a game's score; a lost game counts this much.
  ('flag_weight', 0.5), ('lost_weight', 0.5),
  -- Baselines: games of players within ±band of the rating, from the last `days`, blended with
  -- a starting estimate until there are about `prior_games` of them.
  ('baseline_band', 100), ('baseline_days', 180), ('baseline_prior_games', 30),
  ('prior_acc_base', 55), ('prior_acc_per_point', 0.0125), ('prior_acc_sd', 10),
  ('prior_match_base', 0.25), ('prior_match_per_point', 0.00017), ('prior_match_sd', 0.12),
  -- Games of players rated this or more always need a check: without one they wait for a moderator.
  ('always_check_rating', 1800);

create function public.fairplay_value(p_key text)
returns numeric language sql stable security definer set search_path = '' as $$
  select value from public.fairplay_config where key = p_key
$$;

-- Each browser's analysis of a finished rated game (format: @xq/online fairplay.ts).
create table public.game_analysis (
  game_id uuid not null references public.games (id) on delete cascade,
  by_color text not null check (by_color in ('red', 'black')),
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, by_color)
);
alter table public.game_analysis enable row level security;
revoke all on public.game_analysis from anon, authenticated;

-- The game's check: {status: 'one' | 'disagree' | 'checked' | 'missing', red, black} with each
-- side's scores when checked (@xq/online server/fairplay.ts).
alter table public.games add column fairplay jsonb;

-- Each player's standing at each speed, from their recent checked games. Private.
create table public.fairplay (
  user_id uuid not null references auth.users (id) on delete cascade,
  speed text not null,
  games int not null,
  score numeric not null,
  far int not null,
  verdict text not null check (verdict in ('normal', 'watch', 'likely')),
  updated_at timestamptz not null default now(),
  primary key (user_id, speed)
);
alter table public.fairplay enable row level security;
revoke all on public.fairplay from anon, authenticated;

/** Stores one browser's analysis (the `game` function) and returns both so far: {red, black}. */
create function public.save_analysis(p_game uuid, p_by text, p_data jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  insert into public.game_analysis (game_id, by_color, data) values (p_game, p_by, p_data)
  on conflict (game_id, by_color) do update set data = excluded.data, created_at = now();
  select coalesce(jsonb_object_agg(by_color, data), '{}'::jsonb) from public.game_analysis where game_id = p_game;
$$;

/** A side's score in a checked game, with its flags added: what a player's standing is built from. */
create function public.fairplay_evidence(side jsonb)
returns numeric language sql stable set search_path = '' as $$
  select (side->>'z')::numeric + public.fairplay_value('flag_weight') * jsonb_array_length(coalesce(side->'flags', '[]'::jsonb))
$$;

/**
 * Honest players of a speed near a rating: mean and spread of accuracy and engine match from
 * checked games (players whose standing is "likely" left out), blended with a starting estimate
 * while there are few. {acc: {mean, sd}, match: {mean, sd}, games}.
 */
create function public.fairplay_baseline(p_speed text, p_rating int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  band numeric := public.fairplay_value('baseline_band');
  prior_n numeric := public.fairplay_value('baseline_prior_games');
  pa numeric := least(92, greatest(45, public.fairplay_value('prior_acc_base') + public.fairplay_value('prior_acc_per_point') * (p_rating - 800)));
  pm numeric := least(0.65, greatest(0.15, public.fairplay_value('prior_match_base') + public.fairplay_value('prior_match_per_point') * (p_rating - 800)));
  pas numeric := public.fairplay_value('prior_acc_sd');
  pms numeric := public.fairplay_value('prior_match_sd');
  n int;
  ma numeric; sa numeric; mm numeric; sm numeric;
  w numeric;
begin
  select count(*), avg(acc), coalesce(stddev_pop(acc), 0), avg(match), coalesce(stddev_pop(match), 0) into n, ma, sa, mm, sm
  from (
    select (g.fairplay->s.color->>'acc')::numeric as acc, (g.fairplay->s.color->>'match')::numeric as match
    from public.games g
    cross join lateral (values ('red', g.red, g.red_rating_before), ('black', g.black, g.black_rating_before)) as s(color, player, rating)
    where g.speed = p_speed and g.fairplay->>'status' = 'checked' and g.ended_at > now() - make_interval(days => public.fairplay_value('baseline_days')::int)
      and g.fairplay->s.color->>'z' is not null and abs(s.rating - p_rating) <= band
      and not exists (select 1 from public.fairplay f where f.user_id = s.player and f.speed = p_speed and f.verdict = 'likely')
  ) x;
  w := n / (n + prior_n);
  return jsonb_build_object(
    'acc', jsonb_build_object('mean', round(w * coalesce(ma, 0) + (1 - w) * pa, 2), 'sd', round(greatest(5, sqrt(w * sa ^ 2 + (1 - w) * pas ^ 2)), 2)),
    'match', jsonb_build_object('mean', round(w * coalesce(mm, 0) + (1 - w) * pm, 4), 'sd', round(greatest(0.06, sqrt(w * sm ^ 2 + (1 - w) * pms ^ 2)), 4)),
    'games', n);
end $$;

/**
 * A player's standing at a speed from their last checked games of enough length: Stouffer's
 * combination (lost games count less), and how many games were far out of line. "likely" needs
 * enough games, a combined score past `likely_z` and several games past `far_z`.
 */
create function public.update_fairplay_player(p_user uuid, p_speed text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  n int; z numeric; far int;
  verdict text;
  needed numeric := case when p_speed = 'lightning' then public.fairplay_value('min_games_lightning') else public.fairplay_value('min_games') end;
begin
  if p_user is null then return; end if;
  select count(*), coalesce(sum(w * e) / nullif(sqrt(sum(w * w)), 0), 0), count(*) filter (where e >= public.fairplay_value('far_z'))
    into n, z, far
  from (
    select public.fairplay_evidence(g.fairplay->(case when g.red = p_user then 'red' else 'black' end)) as e,
      case when g.result = (case when g.red = p_user then 'black' else 'red' end) then public.fairplay_value('lost_weight') else 1 end as w
    from public.games g
    where p_user in (g.red, g.black) and g.speed = p_speed and g.fairplay->>'status' = 'checked'
      and coalesce(array_length(g.moves, 1), 0) >= public.fairplay_value('min_plies')
      and g.fairplay->(case when g.red = p_user then 'red' else 'black' end)->>'z' is not null
    order by g.ended_at desc limit public.fairplay_value('recent_games')::int
  ) x;
  verdict := case
    when n >= needed and z >= public.fairplay_value('likely_z') and far >= public.fairplay_value('far_games') then 'likely'
    when z >= public.fairplay_value('watch_z') then 'watch'
    else 'normal' end;
  insert into public.fairplay (user_id, speed, games, score, far, verdict) values (p_user, p_speed, n, round(z, 2), far, verdict)
  on conflict (user_id, speed) do update set games = excluded.games, score = excluded.score, far = excluded.far,
    verdict = excluded.verdict, updated_at = now();
end $$;

/** Saves a game's check (the `game` function) and, once checked, both players' standing. */
create function public.save_fairplay(p_game uuid, p_record jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game for update;
  if not found then return; end if;
  -- A first analysis doesn't undo a check already made.
  if p_record->>'status' = 'one' and g.fairplay is not null then return; end if;
  update public.games set fairplay = p_record || jsonb_build_object('at', now()) where id = p_game;
  if p_record->>'status' = 'checked' then
    perform public.update_fairplay_player(g.red, g.speed);
    perform public.update_fairplay_player(g.black, g.speed);
  end if;
end $$;

/**
 * Fair-play checked games: the player's games that both browsers analysed alike, long enough to
 * score, and not far out of line. Shown on profiles; an opponent filter asks for 10.
 */
create function public.checked_games_of(p_user uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.games g
  where p_user in (g.red, g.black) and g.fairplay->>'status' = 'checked'
    and coalesce(array_length(g.moves, 1), 0) >= public.fairplay_value('min_plies')
    and g.fairplay->(case when g.red = p_user then 'red' else 'black' end)->>'z' is not null
    and public.fairplay_evidence(g.fairplay->(case when g.red = p_user then 'red' else 'black' end)) < public.fairplay_value('far_z')
$$;

/** Rated games of strong players that neither browser checked within a day wait for a moderator (M19). */
create function public.mark_unchecked_games()
returns void language sql security definer set search_path = '' as $$
  update public.games g set fairplay = jsonb_build_object('status', 'missing', 'at', now())
  where g.status = 'over' and g.rated and g.ended_at < now() - interval '1 day' and g.ended_at > now() - interval '8 days'
    and (g.fairplay is null or g.fairplay->>'status' = 'one')
    and greatest(g.red_rating_before, g.black_rating_before) >= public.fairplay_value('always_check_rating')
$$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('mark-unchecked-games', '17 * * * *', 'select public.mark_unchecked_games()');
  end if;
end $$;

-- The public profile, as before, now with the checked-game count.
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
    'checked_games', public.checked_games_of(p.user_id),
    'violation', null,
    'blocked', exists (select 1 from public.blocks b where b.user_id = auth.uid() and b.blocked_id = p.user_id),
    'me', p.user_id = auth.uid()
  )
  from public.profiles p where lower(p.username) = lower(p_username)
$$;

-- Matching -------------------------------------------------------------------------------------

-- What other players' filters look at, and quiet separate matching (decision D5): a player
-- whose standing is "likely" is matched only with others in the same position.
alter table public.seeks
  add column checked int not null default 0,
  add column finding boolean not null default false,
  add column checked_only boolean not null default false,
  add column quiet boolean not null default false;

create or replace function public.seek_filters(a public.seeks, b public.seeks)
returns boolean language sql stable set search_path = '' as $$
  select (not a.established_only or b.games >= 10)
    and b.account_created <= now() - make_interval(days => a.min_account_days)
    and (a.min_completion = 0 or b.completion is null or b.completion >= a.min_completion)
    and (not a.checked_only or (b.checked >= 10 and not b.finding))
$$;

create or replace function public.seek_fits(a public.seeks, b public.seeks)
returns boolean language sql stable security definer set search_path = '' as $$
  select b.user_id <> a.user_id and b.game_id is null and b.seen_at > now() - interval '10 seconds'
    and b.base = a.base and b.inc = a.inc and b.pool = a.pool and b.quiet = a.quiet
    and not exists (select 1 from public.blocks k where (k.user_id = a.user_id and k.blocked_id = b.user_id) or (k.user_id = b.user_id and k.blocked_id = a.user_id))
    and public.seek_filters(a, b) and public.seek_filters(b, a)
$$;

/**
 * As in M17, plus the fair-play side: p_filters.checked asks for opponents with 10 or more
 * checked games and no finding; the seek carries the player's own count, and whether their
 * standing at this speed is "likely" (quiet matching).
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
  perform pg_advisory_xact_lock(1717);
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
    anyone = false, created_at = now(), seen_at = now(), game_id = null;
  delete from public.seek_invites where from_user = me;
end $$;

-- Access ----------------------------------------------------------------------------------

revoke all on function public.fairplay_value(text), public.save_analysis(uuid, text, jsonb), public.fairplay_evidence(jsonb),
  public.fairplay_baseline(text, int), public.update_fairplay_player(uuid, text), public.save_fairplay(uuid, jsonb),
  public.checked_games_of(uuid), public.mark_unchecked_games()
  from public, anon, authenticated;
grant execute on function public.save_analysis(uuid, text, jsonb), public.fairplay_baseline(text, int), public.save_fairplay(uuid, jsonb),
  public.mark_unchecked_games() to service_role;
