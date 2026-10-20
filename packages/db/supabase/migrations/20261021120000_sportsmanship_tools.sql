-- After M20: the completion rate from a player's first game, and two moderator tools.
-- - Completion rate: shown only from 5 games, a new account had none, and "none" passes every
--   filter, so throwaway accounts slipped through; counted raw from the first game, one accident
--   would sink a normal player. Every player now starts with a clean record worth 5 finished
--   games: (finished + 5) / (games + 5), from the first game.
-- - Moderators can excuse a single sportsmanship mark (a site fault, a test game), or reset a
--   player's sportsmanship record so that only games from then on count. Both are logged.

alter table public.profiles add column sport_cleared_at timestamptz;

/** Games that count for a player's sportsmanship: finished, and since their record was last reset. */
create function public.sport_counts(g public.games, p_user uuid)
returns boolean language sql stable set search_path = '' as $$
  select g.status = 'over' and p_user in (g.red, g.black)
    and g.ended_at > coalesce((select sport_cleared_at from public.profiles where user_id = p_user), '-infinity'::timestamptz)
$$;

/**
 * Completion rate (棋品): of the player's online games in the last 90 days (since any reset),
 * the per cent not abandoned, stalled or aborted by them, counting from a clean record worth 5
 * finished games. Null before the first game.
 */
create or replace function public.completion_of(p_user uuid)
returns int language sql stable security definer set search_path = '' as $$
  select case when count(*) > 0 then
    round(100.0 * (count(*) filter (where not public.labels_of(g, p_user) ?| array['abandoned', 'stalled', 'aborted']) + 5) / (count(*) + 5))::int end
  from public.games g
  where public.sport_counts(g, p_user) and g.started_at > now() - interval '90 days'
$$;

/** As in M17, counting only games since the record was last reset. */
create or replace function public.sportsmanship_of(p_user uuid)
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
  where g.id in (select x.id from public.games x where public.sport_counts(x, p_user) order by x.ended_at desc limit 30);

  select coalesce(array_agg(g.ended_at), '{}') into faults
  from public.games g
  where public.sport_counts(g, p_user) and g.ended_at > now() - interval '3 days'
    and public.labels_of(g, p_user) ?| array['abandoned', 'stalled'];
  -- Frequent aborts: the latest of them counts as one fault.
  if (select count(*) filter (where public.labels_of(g, p_user) ? 'aborted')
      from public.games g
      where g.id in (select x.id from public.games x where public.sport_counts(x, p_user) order by x.ended_at desc limit 10)) >= 4 then
    faults := faults || (select max(g.ended_at) from public.games g
                         where public.sport_counts(g, p_user) and public.labels_of(g, p_user) ? 'aborted'
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

/**
 * Removes one sportsmanship mark from a player's side of a game (a site fault, a test game):
 * the completion rate and penalties follow at once. Logged with the mark it removed.
 */
create function public.mod_excuse_label(p_game uuid, p_username text, p_label text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
  g public.games;
  side text;
begin
  perform public.require_moderator();
  if p_label not in ('abandoned', 'stalled', 'aborted', 'slow-start') then raise exception 'not a sportsmanship mark' using errcode = '22023'; end if;
  select user_id into u from public.profiles where lower(username) = lower(p_username);
  select * into g from public.games where id = p_game for update;
  if u is null or not found or u not in (g.red, g.black) then raise exception 'no such player in that game' using errcode = 'P0002'; end if;
  side := case when g.red = u then 'red' else 'black' end;
  if not coalesce(g.labels->side, '[]'::jsonb) ? p_label then raise exception 'no such mark on that game' using errcode = 'P0002'; end if;
  update public.games set labels = jsonb_set(labels, array[side], (labels->side) - p_label) where id = p_game;
  perform public.log_mod_action('excuse-mark', u, jsonb_build_object('note', p_note, 'game', p_game, 'mark', p_label));
end $$;

/** Starts a player's sportsmanship record afresh: only games from now count, and any warning is cleared. Logged. */
create function public.mod_reset_sportsmanship(p_username text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
begin
  perform public.require_moderator();
  update public.profiles set sport_cleared_at = now(), sport_warned_at = null where lower(username) = lower(p_username) returning user_id into u;
  if u is null then raise exception 'no such player' using errcode = 'P0002'; end if;
  perform public.log_mod_action('reset-sportsmanship', u, jsonb_build_object('note', p_note));
end $$;

revoke all on function public.sport_counts(public.games, uuid), public.mod_excuse_label(uuid, text, text, text), public.mod_reset_sportsmanship(text, text)
  from public, anon, authenticated;
grant execute on function public.mod_excuse_label(uuid, text, text, text), public.mod_reset_sportsmanship(text, text) to authenticated;
