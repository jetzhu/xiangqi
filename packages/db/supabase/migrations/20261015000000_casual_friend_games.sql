-- Friend games without the bot-game check (changed 2026-10-15). The check before the first
-- online game (D9) makes a throwaway account cost time, which matters for games between
-- strangers. A challenge link goes to someone the challenger chose, so a casual friend game
-- needs only a verified email and the birth month (for the under-16 protections). A rated one
-- still needs the full check from both players, so a second account can't feed a rating.

/** As before, plus 'casual_ok': ready for a casual friend game (verified email, birth month). */
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
    'casual_ok', me.verified and me.born is not null,
    'eligible', me.verified and me.born is not null and (done.clean_win or done.long_games >= 3)
  )
  from me, done
$$;

create or replace function public.create_challenge(p_base int, p_inc int, p_color text, p_rated boolean, p_relay boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  new_code text;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not coalesce((public.online_eligibility()->>case when p_rated then 'eligible' else 'casual_ok' end)::boolean, false) then
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

drop function public.accept_challenge(text, boolean);

/**
 * As in M16, but a casual challenge needs only a verified email and the birth month, and a
 * player not yet ready for rated games may accept a rated challenge as casual (p_casual).
 */
create function public.accept_challenge(p_code text, p_relay boolean, p_casual boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.challenges;
  red uuid;
  black uuid;
  relay boolean;
  rated boolean;
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
  rated := c.rated and not coalesce(p_casual, false);
  if not coalesce((public.online_eligibility()->>case when rated then 'eligible' else 'casual_ok' end)::boolean, false) then
    raise exception 'not ready for online play' using errcode = '42501';
  end if;
  if c.color = 'red' or (c.color = 'random' and random() < 0.5) then
    red := c.from_user; black := me;
  else
    red := me; black := c.from_user;
  end if;
  relay := c.relay or coalesce(p_relay, false)
    or exists (select 1 from public.profiles p where p.user_id in (red, black) and public.is_under16(p));
  insert into public.games (red, black, base, inc, speed, rated, relay)
  values (red, black, c.base, c.inc, public.speed_of(c.base, c.inc), rated, relay)
  returning id into game;
  update public.challenges set game_id = game where code = c.code;
  perform public.speed_rating(red, public.speed_of(c.base, c.inc));
  perform public.speed_rating(black, public.speed_of(c.base, c.inc));
  return game;
end $$;

-- Supabase grants new functions to every API role; take that back first.
revoke all on function public.accept_challenge(text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.accept_challenge(text, boolean, boolean) to authenticated;
