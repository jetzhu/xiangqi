-- M15, v0.3 groundwork (docs/v0.3-online-design.md): one rating per online speed, the age
-- answer online play needs, blocking, public profiles, and the check before a player's first
-- online game. Online games themselves come in M16.

-- Ratings: one per speed (Lightning, Blitz, Rapid) in place of the single "online" kind
-- planned in v0.2, which nothing ever wrote.
alter table public.ratings drop constraint ratings_kind_check;
alter table public.ratings add constraint ratings_kind_check
  check (kind in ('bot', 'puzzle', 'lightning', 'blitz', 'rapid'));

-- The bot ladder (id and rating label), kept in step with content/bots/bots.json by
-- scripts/apply.mjs, so the database knows the bots' ratings without trusting the browser.
create table public.bot_ladder (
  id text primary key,
  rating int not null
);
alter table public.bot_ladder enable row level security;
revoke all on public.bot_ladder from anon, authenticated;

-- Asked once, before the first online game. Nothing else about age is kept. Under 16: a
-- minimal public profile, and games always relayed so the opponent never sees their network
-- address. Null until answered.
alter table public.profiles add column under16 boolean;

/** Records the answer to "Are you 16 or older?". Once given, it can't be changed from the site. */
create function public.set_age_group(p_sixteen_or_older boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_sixteen_or_older is null then raise exception 'sign in first' using errcode = '42501'; end if;
  update public.profiles set under16 = not p_sixteen_or_older where user_id = auth.uid() and under16 is null;
end
$$;

-- Blocking --------------------------------------------------------------------------------

-- A blocked player is never matched with the blocker and can't challenge them (M16, M17).
create table public.blocks (
  user_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id),
  check (user_id <> blocked_id)
);
alter table public.blocks enable row level security;
revoke all on public.blocks from anon, authenticated;

/** Blocks or unblocks a player by username. Returns false if there's no such player. */
create function public.set_blocked(p_username text, p_blocked boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  them uuid;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select user_id into them from public.profiles where lower(username) = lower(p_username);
  if them is null or them = me then return false; end if;
  if p_blocked then
    insert into public.blocks (user_id, blocked_id) values (me, them) on conflict do nothing;
  else
    delete from public.blocks where user_id = me and blocked_id = them;
  end if;
  return true;
end
$$;

/** The usernames the player has blocked, newest first. */
create function public.my_blocks()
returns table (username text, blocked_at timestamptz) language sql stable security definer set search_path = '' as $$
  select p.username, b.created_at from public.blocks b join public.profiles p on p.user_id = b.blocked_id
  where b.user_id = auth.uid() order by b.created_at desc
$$;

-- Public profiles --------------------------------------------------------------------------

/**
 * What anyone may see of a player: username, avatar, country, member since, online ratings,
 * and the Fair-play record (completion rate from M17, checked games from M18, confirmed
 * violations from M19; empty until then). Players under 16, or who haven't said, show only
 * their username and ratings. Null if there's no such player.
 */
create function public.public_profile(p_username text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'username', p.username,
    'minimal', p.under16 is distinct from false,
    'avatar', case when p.under16 is false then p.avatar end,
    'country', case when p.under16 is false then p.country end,
    'member_since', case when p.under16 is false then p.created_at end,
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

-- The check before the first online game ----------------------------------------------------

/**
 * Whether the signed-in player may play online (decision D9): a verified email, the age
 * question answered, and either a win without hints or takebacks against a bot rated at or
 * above their level (the strongest bot for anyone above the ladder), or 3 finished bot games
 * of at least 10 moves each. Their level is their bot rating, which starts from the skill
 * answer at sign-up (800 if skipped).
 */
create function public.online_eligibility()
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (
    select u.id, u.email_confirmed_at is not null as verified, p.under16,
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
    'age_answered', me.under16 is not null,
    'under16', me.under16,
    'level', me.level,
    'target', (select rating from target),
    'clean_win', done.clean_win,
    'long_games', done.long_games,
    'eligible', me.verified and me.under16 is not null and (done.clean_win or done.long_games >= 3)
  )
  from me, done
$$;

-- Supabase grants new functions to every API role; take that back first.
revoke all on function public.set_age_group(boolean), public.set_blocked(text, boolean), public.my_blocks(),
  public.public_profile(text), public.online_eligibility() from public, anon, authenticated;
grant execute on function public.set_age_group(boolean), public.set_blocked(text, boolean), public.my_blocks(),
  public.online_eligibility() to authenticated;
grant execute on function public.public_profile(text) to anon, authenticated;
