-- M20, second step from the load test: with 100 players searching one tile, a find_match call
-- took 77 ms, nearly all of it two scans calling small functions per candidate (filters, block
-- check, both rating windows). The checks are now written out in one scan, which finds the match
-- and the nearest players outside the window together.

/** A seeker's rating window now, or null for no limit (seek_window, as an expression on its columns). */
create or replace function public.seek_window_of(anyone boolean, max_diff int, provisional boolean, created_at timestamptz)
returns int language sql stable set search_path = '' as $$
  select case when anyone then max_diff
    else least(coalesce(max_diff, 200), 200, (case when provisional then 150 else 50 end) + 25 * floor(extract(epoch from now() - created_at) / 5)::int) end
$$;

create or replace function public.find_match()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  s public.seeks;
  o public.seeks;
  my_window int;
  game uuid;
  nearest jsonb;
  fits jsonb;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into s from public.seeks where user_id = me for update;
  if not found then return jsonb_build_object('status', 'idle'); end if;
  if s.game_id is not null then
    delete from public.seeks where user_id = me;
    return jsonb_build_object('status', 'matched', 'game', s.game_id);
  end if;
  update public.seeks set seen_at = now() where user_id = me returning * into s;
  my_window := public.seek_window_of(s.anyone, s.max_diff, s.provisional, s.created_at);

  -- One scan of the live seeks on this tile that fit both ways (pool, block, filters), nearest first.
  select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'rating', x.rating, 'gap', abs(x.rating - s.rating), 'created_at', x.created_at,
    'in_window', (my_window is null or abs(x.rating - s.rating) <= my_window)
      and (public.seek_window_of(x.anyone, x.max_diff, x.provisional, x.created_at) is null
           or abs(x.rating - s.rating) <= public.seek_window_of(x.anyone, x.max_diff, x.provisional, x.created_at)))), '[]'::jsonb)
  into fits
  from public.seeks x
  where x.base = s.base and x.inc = s.inc and x.game_id is null and x.seen_at > now() - interval '10 seconds' and x.user_id <> me
    and x.pool = s.pool and x.quiet = s.quiet
    -- s's filters accept x, and x's accept s
    and (not s.established_only or x.games >= 10) and (not x.established_only or s.games >= 10)
    and x.account_created <= now() - make_interval(days => s.min_account_days) and s.account_created <= now() - make_interval(days => x.min_account_days)
    and (s.min_completion = 0 or x.completion is null or x.completion >= s.min_completion)
    and (x.min_completion = 0 or s.completion is null or s.completion >= x.min_completion)
    and (not s.checked_only or (x.checked >= 10 and not x.finding)) and (not x.checked_only or (s.checked >= 10 and not s.finding))
    and not exists (select 1 from public.blocks k where (k.user_id = me and k.blocked_id = x.user_id) or (k.user_id = x.user_id and k.blocked_id = me));

  -- The nearest in both windows, unless another call holds it.
  select x.* into o from public.seeks x
  where x.user_id in (select f.user_id from jsonb_to_recordset(fits) f(user_id uuid, gap int, created_at timestamptz, in_window boolean)
                      where f.in_window order by f.gap, f.created_at limit 5)
    and x.game_id is null
  order by abs(x.rating - s.rating), x.created_at
  limit 1 for update skip locked;
  if found then
    game := public.pair_seeks(s, o);
    delete from public.seeks where user_id = me;
    return jsonb_build_object('status', 'matched', 'game', game);
  end if;

  select coalesce(jsonb_agg(n order by n.gap), '[]'::jsonb) into nearest from (
    select p.username, f.rating, f.gap, f.rating - s.rating as diff, floor(extract(epoch from now() - f.created_at))::int as waited,
      exists (select 1 from public.seek_invites i where i.from_user = me and i.to_user = f.user_id and i.created_at > now() - interval '15 seconds') as invited
    from jsonb_to_recordset(fits) f(user_id uuid, rating int, gap int, created_at timestamptz, in_window boolean) join public.profiles p on p.user_id = f.user_id
    where not f.in_window order by f.gap limit 3) n;

  return jsonb_build_object(
    'status', 'searching',
    'window', my_window,
    'anyone', s.anyone,
    'waited', floor(extract(epoch from now() - s.created_at))::int,
    'nearest', nearest,
    'invite', (
      select jsonb_build_object('id', i.id, 'rating', x.rating, 'diff', x.rating - s.rating,
        'expires_in', ceil(15 - extract(epoch from now() - i.created_at))::int)
      from public.seek_invites i join public.seeks x on x.user_id = i.from_user
      where i.to_user = me and i.created_at > now() - interval '15 seconds' and public.seek_fits(s, x)
      order by i.created_at desc limit 1),
    'counts', public.seek_counts());
end $$;

revoke all on function public.seek_window_of(boolean, int, boolean, timestamptz) from public, anon, authenticated;
