-- Online games in the history pages (settled 2026-10-20, as chess.com does): a player's own
-- online games and stats, a public list of each player's games on their profile, and any finished
-- game open to anyone to replay. The one exception is the safety rule of the minimal profile:
-- a player under 16 (or who hasn't given a birth month) has no public game list, and games they
-- played in open only to their two players.

/** Whether anyone may see a finished game: over, and no player in it under 16 (a deleted player's place doesn't count). */
create function public.game_public(g public.games)
returns boolean language sql stable security definer set search_path = '' as $$
  select g.status = 'over'
    and not exists (select 1 from public.profiles p where p.user_id in (g.red, g.black) and public.is_under16(p))
$$;

/**
 * Finished games of a player, newest first, before `p_before` (for paging), from the player's
 * side: opponent, colour, result (win, draw, loss, or none for no result), how it ended, and their
 * rating before and after. `p_public`: only games anyone may see.
 */
create function public.games_of(p_user uuid, p_before timestamptz, p_limit int, p_public boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x.ended_at desc), '[]'::jsonb) from (
    select g.id, g.ended_at, g.speed, g.base, g.inc, g.rated,
      case when g.red = p_user then 'red' else 'black' end as color,
      op.username as opponent,
      case when g.result = 'none' then 'none' when g.result = 'draw' then 'draw'
           when g.result = (case when g.red = p_user then 'red' else 'black' end) then 'win' else 'loss' end as result,
      g.reason,
      coalesce(array_length(g.moves, 1), 0) as plies,
      case when g.red = p_user then g.red_rating_before else g.black_rating_before end as rating_before,
      case when g.red = p_user then g.red_rating_after else g.black_rating_after end as rating_after
    from public.games g
    left join public.profiles op on op.user_id = case when g.red = p_user then g.black else g.red end
    where p_user in (g.red, g.black) and g.status = 'over' and g.ended_at < coalesce(p_before, 'infinity'::timestamptz)
      and (not p_public or public.game_public(g))
    order by g.ended_at desc
    limit least(greatest(p_limit, 1), 100)
  ) x
$$;

/** The signed-in player's own finished online games (all of them, casual and rated). */
create function public.my_games(p_before timestamptz default null, p_limit int default 20)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then '[]'::jsonb else public.games_of(auth.uid(), p_before, p_limit, false) end
$$;

/** A player's public game list (their profile); null for a minimal profile (under 16, or no birth month). */
create function public.player_games(p_username text, p_before timestamptz default null, p_limit int default 20)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.is_under16(p) then null else public.games_of(p.user_id, p_before, p_limit, true) end
  from public.profiles p where lower(p.username) = lower(p_username)
$$;

/**
 * The signed-in player's online stats per speed: current rating, rated games, peak, the rating
 * after each rated game (for the chart), and results overall, as Red and as Black.
 */
create function public.my_online_stats()
returns jsonb language sql stable security definer set search_path = '' as $$
  with mine as (
    select g.speed, g.ended_at as at, g.rated,
      case when g.red = auth.uid() then 'red' else 'black' end as color,
      case when g.result = 'none' then 'none' when g.result = 'draw' then 'draw'
           when g.result = (case when g.red = auth.uid() then 'red' else 'black' end) then 'win' else 'loss' end as result,
      case when g.red = auth.uid() then g.red_rating_after else g.black_rating_after end as after
    from public.games g
    where auth.uid() in (g.red, g.black) and g.status = 'over'
  ), tally as (
    select speed, color, count(*) filter (where result <> 'none') as games, count(*) filter (where result = 'win') as wins,
      count(*) filter (where result = 'draw') as draws, count(*) filter (where result = 'loss') as losses
    from mine group by speed, color
  )
  select coalesce(jsonb_object_agg(s.speed, jsonb_build_object(
    'rating', (select round(r.rating) from public.ratings r where r.user_id = auth.uid() and r.kind = s.speed),
    'rd', (select round(r.rd) from public.ratings r where r.user_id = auth.uid() and r.kind = s.speed),
    'rated_games', (select r.games from public.ratings r where r.user_id = auth.uid() and r.kind = s.speed),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', m.at, 'rating', m.after) order by m.at) from mine m
                         where m.speed = s.speed and m.rated and m.after is not null), '[]'::jsonb),
    'results', jsonb_build_object(
      'red', coalesce((select to_jsonb(t) - 'speed' - 'color' from tally t where t.speed = s.speed and t.color = 'red'), '{"games": 0, "wins": 0, "draws": 0, "losses": 0}'),
      'black', coalesce((select to_jsonb(t) - 'speed' - 'color' from tally t where t.speed = s.speed and t.color = 'black'), '{"games": 0, "wins": 0, "draws": 0, "losses": 0}')))), '{}'::jsonb)
  from (select distinct speed from mine) s
$$;

-- A game's page: its players as before, and anyone else for a finished public game ("me" is
-- null for a viewer). Games in progress stay with their players (no spectating in v0.3).
create or replace function public.game_info(p_game uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', g.id,
    'me', public.my_color(g.id),
    'red', jsonb_build_object('username', pr.username, 'avatar', case when not public.is_under16(pr) then pr.avatar end, 'rating', round(rr.rating), 'rd', round(rr.rd)),
    'black', jsonb_build_object('username', pb.username, 'avatar', case when not public.is_under16(pb) then pb.avatar end, 'rating', round(rb.rating), 'rd', round(rb.rd)),
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
  where g.id = p_game and (auth.uid() in (g.red, g.black) or public.game_public(g))
$$;
grant execute on function public.game_info(uuid) to anon;

revoke all on function public.game_public(public.games), public.games_of(uuid, timestamptz, int, boolean), public.my_games(timestamptz, int),
  public.player_games(text, timestamptz, int), public.my_online_stats() from public, anon, authenticated;
grant execute on function public.my_games(timestamptz, int), public.my_online_stats() to authenticated;
grant execute on function public.player_games(text, timestamptz, int) to anon, authenticated;
