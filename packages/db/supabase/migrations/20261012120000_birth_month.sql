-- The birth month in place of M15's one-time "Are you 16 or older?" answer, so a player under
-- 16 is no longer held back once they turn 16. Only the month and year are kept, and the
-- birthday counts as the last day of that month (the rule the sign-up check uses), so a player
-- turns 16 on the first day of the month after. Asked again of everyone: a yes or no can't be
-- turned into a month, and until they answer they count as under 16, as before.
alter table public.profiles drop column under16;
alter table public.profiles
  add column birth_month date check (birth_month = date_trunc('month', birth_month)::date),
  -- A change to an earlier month while a player is under 16 waits a week (and can be withdrawn),
  -- and can be made once; changes to a later month, or once 16, take effect at once.
  add column birth_month_next date check (birth_month_next = date_trunc('month', birth_month_next)::date),
  add column birth_month_next_at timestamptz,
  add column birth_month_earlier_used boolean not null default false;

/** The birth month that counts now: a waiting change once its week is up. Null if not given. */
create function public.birth_month_now(p public.profiles)
returns date language sql stable set search_path = '' as $$
  select case when p.birth_month_next_at <= now() then p.birth_month_next else p.birth_month end
$$;

/** Under 16, or not said. Under 16: a minimal public profile, and games always relayed. */
create function public.is_under16(p public.profiles)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(public.birth_month_now(p) + interval '16 years 1 month' > now(), true)
$$;

drop function public.set_age_group(boolean);

/**
 * Sets the birth month. The first answer, a later month, or any change once 16 applies at once.
 * An earlier month while under 16 would let a player in sooner, so it waits a week and can be
 * made once (setting the current month again withdraws it, and gives the chance back); after
 * that, it's a question for us ('once' in the hint).
 */
create function public.set_birth_month(p_year int, p_month int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  p public.profiles;
  born date;
  now_born date;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_month not between 1 and 12 or p_year < 1900 or make_date(p_year, p_month, 1) > now()::date then
    raise exception 'bad birth month' using errcode = '22023';
  end if;
  born := make_date(p_year, p_month, 1);
  select * into p from public.profiles where user_id = me for update;
  now_born := public.birth_month_now(p);
  if now_born is null or born >= now_born or not public.is_under16(p) then
    update public.profiles set birth_month = born, birth_month_next = null, birth_month_next_at = null,
      -- Withdrawing a change that's still waiting gives the chance back.
      birth_month_earlier_used = birth_month_earlier_used and not coalesce(birth_month_next_at > now(), false)
    where user_id = me;
  elsif p.birth_month_earlier_used and not coalesce(p.birth_month_next_at > now(), false) then
    raise exception 'birth month already corrected' using errcode = 'P0001', hint = 'once';
  else
    update public.profiles set birth_month = now_born, birth_month_next = born,
      birth_month_next_at = now() + interval '7 days', birth_month_earlier_used = true
    where user_id = me;
  end if;
end
$$;

-- What others see, and the check before the first online game, as in M15 with the age now
-- worked out from the birth month.
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
    'completion', null,
    'checked_games', 0,
    'violation', null,
    'blocked', exists (select 1 from public.blocks b where b.user_id = auth.uid() and b.blocked_id = p.user_id),
    'me', p.user_id = auth.uid()
  )
  from public.profiles p where lower(p.username) = lower(p_username)
$$;

/**
 * As in M15, plus the player's own birth month for Settings: 'born' and a waiting 'born_next'
 * as YYYY-MM, when that takes effect, whether the one earlier correction is used, and
 * 'sixteen_on', the day an under-16 player turns 16 here.
 */
create or replace function public.online_eligibility()
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (
    select u.id, u.email_confirmed_at is not null as verified, public.birth_month_now(p) as born,
      public.is_under16(p) as under16, p.birth_month_next, p.birth_month_next_at, p.birth_month_earlier_used,
      coalesce((select round(r.rating)::int from public.ratings r where r.user_id = u.id and r.kind = 'bot'), 800) as level
    from auth.users u join public.profiles p on p.user_id = u.id where u.id = auth.uid()
  ), target as (
    select least(me.level, coalesce((select max(rating) from public.bot_ladder), me.level)) as rating from me
  ), done as (
    select
      exists (select 1 from public.bot_games g, target t where g.user_id = me.id and g.result = 'win'
              and g.helps = 0 and g.bot_rating >= t.rating) as clean_win,
      (select count(*)::int from public.bot_games g where g.user_id = me.id and g.result is not null
              and coalesce(array_length(g.moves, 1), 0) >= 20) as long_games
    from me
  )
  select jsonb_build_object(
    'verified', me.verified,
    'age_answered', me.born is not null,
    'under16', me.under16,
    'born', to_char(me.born, 'YYYY-MM'),
    'born_next', case when me.birth_month_next_at > now() then to_char(me.birth_month_next, 'YYYY-MM') end,
    'born_next_at', case when me.birth_month_next_at > now() then me.birth_month_next_at end,
    'earlier_used', me.birth_month_earlier_used,
    'sixteen_on', case when me.under16 and me.born is not null then (me.born + interval '16 years 1 month')::date end,
    'level', me.level,
    'target', (select rating from target),
    'clean_win', done.clean_win,
    'long_games', done.long_games,
    'eligible', me.verified and me.born is not null and (done.clean_win or done.long_games >= 3)
  )
  from me, done
$$;

-- Supabase grants new functions to every API role; take that back first.
revoke all on function public.birth_month_now(public.profiles), public.is_under16(public.profiles),
  public.set_birth_month(int, int) from public, anon, authenticated;
grant execute on function public.set_birth_month(int, int) to authenticated;
