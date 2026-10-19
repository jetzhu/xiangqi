-- M19, reports and moderation (docs/v0.3-online-design.md, "Reports", "Sanctions and appeals",
-- "Moderation" and the leaderboards under "Ratings"): players report a game's opponent, each
-- reporter has a track record, moderators work a queue of cases on a review page, decide them
-- (dismiss, or confirm a violation with its sanction, refunds and notices), record appeals, and
-- every action goes in an append-only log. Leaderboards per speed.

-- Moderators -----------------------------------------------------------------------------------

-- At first the site owner alone; added by hand.
create table public.moderators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.moderators enable row level security;
revoke all on public.moderators from anon, authenticated;

create function public.is_moderator(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.moderators m where m.user_id = p_user)
$$;

/** Raises unless the caller is a moderator. */
create function public.require_moderator()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_moderator() then raise exception 'moderators only' using errcode = '42501'; end if;
  return auth.uid();
end $$;

-- Every moderator action, with its reason and evidence. Nothing is ever changed or removed.
create table public.mod_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  moderator uuid references auth.users (id) on delete set null,
  action text not null,
  target uuid references auth.users (id) on delete set null,
  details jsonb not null default '{}'
);
alter table public.mod_log enable row level security;
revoke all on public.mod_log from anon, authenticated;
create function public.mod_log_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- A deleted account clears its id (on delete set null); nothing else may change a row.
  if tg_op = 'UPDATE' and new.id = old.id and new.at = old.at and new.action = old.action and new.details = old.details
     and (new.moderator is not distinct from old.moderator or new.moderator is null)
     and (new.target is not distinct from old.target or new.target is null) then
    return new;
  end if;
  raise exception 'the moderator log is append-only' using errcode = '42501';
end $$;
create trigger mod_log_append_only before update or delete on public.mod_log
  for each row execute function public.mod_log_append_only();

create function public.log_mod_action(p_action text, p_target uuid, p_details jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.mod_log (moderator, action, target, details) values (auth.uid(), p_action, p_target, coalesce(p_details, '{}'))
$$;

-- Notices to players ----------------------------------------------------------------------------

-- "Action was taken on your report", "Rating refunded": shown on the Play online page until read.
create table public.notices (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('report-upheld', 'refund', 'sanction', 'appeal')),
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notices_user_idx on public.notices (user_id, created_at desc);
alter table public.notices enable row level security;
revoke all on public.notices from anon, authenticated;

create function public.my_notices()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'data', n.data, 'at', n.created_at) order by n.created_at desc), '[]'::jsonb)
  from public.notices n where n.user_id = auth.uid() and n.read_at is null
$$;

create function public.dismiss_notice(p_id bigint)
returns void language sql security definer set search_path = '' as $$
  update public.notices set read_at = now() where id = p_id and user_id = auth.uid()
$$;

-- Reports ---------------------------------------------------------------------------------------

-- A reporter who keeps reporting falsely loses the right to report.
alter table public.profiles add column report_barred boolean not null default false;
-- When a moderator last cleared the player: their standing counts only games after it.
alter table public.profiles add column fairplay_cleared_at timestamptz;

create table public.reports (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  reporter uuid not null references auth.users (id) on delete cascade,
  suspect uuid not null references auth.users (id) on delete cascade,
  reason text not null check (reason in ('engine', 'stalling', 'chat', 'username', 'other')),
  note text check (length(note) <= 300),
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'upheld', 'dismissed')),
  decided_at timestamptz,
  unique (game_id, reporter)
);
create index reports_suspect_idx on public.reports (suspect, status);
create index reports_reporter_idx on public.reports (reporter, created_at desc);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

/**
 * Reports the opponent in one of the player's own finished online games: within 7 days, once a
 * game, at most 5 a day. Reasons: engine or outside help, stalling, abusive chat, offensive
 * username, other (with a short note).
 */
create function public.report_player(p_game uuid, p_reason text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  g public.games;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into g from public.games where id = p_game;
  if not found or me not in (g.red, g.black) then raise exception 'not your game' using errcode = '42501'; end if;
  if g.status <> 'over' or g.ended_at < now() - interval '7 days' then raise exception 'too late to report' using errcode = '22023'; end if;
  if (select report_barred from public.profiles where user_id = me) then raise exception 'reporting not allowed' using errcode = '42501'; end if;
  if (select count(*) from public.reports where reporter = me and created_at > now() - interval '1 day') >= 5 then
    raise exception 'too many reports today' using errcode = '22023';
  end if;
  if exists (select 1 from public.reports where game_id = p_game and reporter = me) then raise exception 'already reported' using errcode = '23505'; end if;
  insert into public.reports (game_id, reporter, suspect, reason, note)
  values (p_game, me, case when g.red = me then g.black else g.red end, p_reason, nullif(trim(p_note), ''));
end $$;

/** Whether the player has reported this game already (the game page shows "Reported"). */
create function public.reported_game(p_game uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reports where game_id = p_game and reporter = auth.uid())
$$;

-- Sanctions -------------------------------------------------------------------------------------

-- A confirmed violation. Level 1: rated online play suspended 30 days, ratings reset, victims
-- refunded, a public mark for a year. Level 2: all online play suspended at once; closed for
-- online play if no appeal succeeds within 30 days. Overturning an appeal lifts it all.
create table public.sanctions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  level int not null check (level in (1, 2)),
  reason text not null,
  created_at timestamptz not null default now(),
  suspended_until timestamptz,
  public_until timestamptz not null,
  appeal_deadline timestamptz not null,
  -- none, pending (received by email and being reviewed), upheld (sanction stands), overturned.
  appeal text not null default 'none' check (appeal in ('none', 'pending', 'upheld', 'overturned')),
  overturned_at timestamptz,
  moderator uuid references auth.users (id) on delete set null
);
create index sanctions_user_idx on public.sanctions (user_id, created_at desc);
alter table public.sanctions enable row level security;
revoke all on public.sanctions from anon, authenticated;

/**
 * The player's sanction now, or null: {level, suspended_until, closed, appeal, appeal_deadline}.
 * Level 2 closes online play once an appeal is rejected or 30 days pass without one.
 */
create function public.active_sanction(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'level', s.level, 'suspended_until', s.suspended_until,
    'closed', s.level = 2 and (s.appeal = 'upheld' or (s.appeal = 'none' and s.appeal_deadline < now())),
    'appeal', s.appeal, 'appeal_deadline', s.appeal_deadline)
  from public.sanctions s
  where s.user_id = p_user and s.overturned_at is null
    and (s.level = 2 or s.suspended_until > now())
  order by s.level desc, s.created_at desc limit 1
$$;

/**
 * A reporter's track record: reports made and upheld, and the weight their reports carry,
 * (upheld + 1) / (made + 2), so a new reporter starts at a half and someone who reports every
 * loss counts for little. Nothing for a barred reporter or one with a confirmed violation.
 */
create function public.reporter_record(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'made', count(*) filter (where r.status <> 'open'),
    'upheld', count(*) filter (where r.status = 'upheld'),
    'weight', case
      when (select report_barred from public.profiles where user_id = p_user) then 0
      when exists (select 1 from public.sanctions s where s.user_id = p_user and s.overturned_at is null) then 0
      else round((count(*) filter (where r.status = 'upheld') + 1.0) / (count(*) filter (where r.status <> 'open') + 2.0), 2) end)
  from public.reports r where r.reporter = p_user
$$;

/** The public mark: a confirmed violation in the last year (not overturned). */
create function public.public_mark(p_user uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select max(s.created_at) from public.sanctions s where s.user_id = p_user and s.overturned_at is null and s.public_until > now()
$$;

create table public.refunds (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id uuid references public.games (id) on delete set null,
  sanction_id bigint not null references public.sanctions (id) on delete cascade,
  speed text not null,
  amount int not null,
  created_at timestamptz not null default now()
);
alter table public.refunds enable row level security;
revoke all on public.refunds from anon, authenticated;

-- The check before online play, as before, now with any sanction: level 1 stops rated play
-- (quick pairing, rated challenges), level 2 stops all online play.
create or replace function public.online_eligibility()
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (
    select u.id, u.email_confirmed_at is not null as verified, public.birth_month_now(p) as born,
      public.is_under16(p) as under16, p.birth_month_next, p.birth_month_next_at, p.birth_month_earlier_used,
      coalesce((select round(r.rating)::int from public.ratings r where r.user_id = u.id and r.kind = 'bot'), 800) as level,
      public.active_sanction(u.id) as sanction
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
    'sanction', me.sanction,
    'casual_ok', me.verified and me.born is not null and coalesce((me.sanction->>'level')::int, 0) < 2,
    'eligible', me.verified and me.born is not null and (done.clean_win or done.long_games >= 3) and me.sanction is null
  )
  from me, done
$$;

-- A confirmed mark counts as a finding for the "fair-play checked" opponent filter.
create function public.seeks_mark_finding()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.finding := new.finding or public.public_mark(new.user_id) is not null;
  return new;
end $$;
create trigger seeks_mark_finding before insert or update on public.seeks
  for each row execute function public.seeks_mark_finding();

-- A player's standing counts only games since a moderator last cleared them.
create or replace function public.update_fairplay_player(p_user uuid, p_speed text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  n int; z numeric; far int;
  verdict text;
  needed numeric := case when p_speed = 'lightning' then public.fairplay_value('min_games_lightning') else public.fairplay_value('min_games') end;
  cleared timestamptz := (select fairplay_cleared_at from public.profiles where user_id = p_user);
begin
  if p_user is null then return; end if;
  select count(*), coalesce(sum(w * e) / nullif(sqrt(sum(w * w)), 0), 0), count(*) filter (where e >= public.fairplay_value('far_z'))
    into n, z, far
  from (
    select public.fairplay_evidence(g.fairplay->(case when g.red = p_user then 'red' else 'black' end)) as e,
      case when g.result = (case when g.red = p_user then 'black' else 'red' end) then public.fairplay_value('lost_weight') else 1 end as w
    from public.games g
    where p_user in (g.red, g.black) and g.speed = p_speed and g.fairplay->>'status' = 'checked'
      and (cleared is null or g.ended_at > cleared)
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

-- Leaderboards ----------------------------------------------------------------------------------

/**
 * Whether a player is on the leaderboard for a speed: 30 rated games, a settled rating
 * (uncertainty 110 or less), a game in the last 30 days, 10 fair-play checked games, and no
 * public mark.
 */
create function public.on_leaderboard(p_user uuid, p_speed text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ratings r
    where r.user_id = p_user and r.kind = p_speed and r.games >= 30 and r.rd <= 110 and r.last_played > now() - interval '30 days')
    and public.checked_games_of(p_user) >= 10 and public.public_mark(p_user) is null
$$;

/** The top 50 of a speed: rank, username, rating, rated games. */
create function public.leaderboard(p_speed text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('rank', x.rank, 'username', x.username, 'rating', x.rating, 'games', x.games) order by x.rank), '[]'::jsonb)
  from (
    select row_number() over (order by r.rating desc, r.games desc) as rank, p.username, round(r.rating)::int as rating, r.games
    from public.ratings r join public.profiles p on p.user_id = r.user_id
    where r.kind = p_speed and public.on_leaderboard(r.user_id, p_speed)
    order by r.rating desc, r.games desc limit 50
  ) x
$$;

-- Games of anyone on a leaderboard always need a check, like those of players rated 1800 or more.
create or replace function public.mark_unchecked_games()
returns void language sql security definer set search_path = '' as $$
  update public.games g set fairplay = jsonb_build_object('status', 'missing', 'at', now())
  where g.status = 'over' and g.rated and g.ended_at < now() - interval '1 day' and g.ended_at > now() - interval '8 days'
    and (g.fairplay is null or g.fairplay->>'status' = 'one')
    and (greatest(g.red_rating_before, g.black_rating_before) >= public.fairplay_value('always_check_rating')
         or public.on_leaderboard(g.red, g.speed) or public.on_leaderboard(g.black, g.speed))
$$;

-- The public profile, as before, with a confirmed violation shown (the date) for a year.
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
    'violation', case when public.public_mark(p.user_id) is not null then jsonb_build_object('at', public.public_mark(p.user_id)) end,
    'blocked', exists (select 1 from public.blocks b where b.user_id = auth.uid() and b.blocked_id = p.user_id),
    'me', p.user_id = auth.uid()
  )
  from public.profiles p where lower(p.username) = lower(p_username)
$$;

-- The review queue and page (moderators only) -------------------------------------------------

/**
 * The cases waiting for a moderator, strongest evidence and highest-rated first: players with
 * open reports (weighted by their reporters' records), a standing of "watch" or "likely", or
 * games whose check is missing or disputed.
 */
create function public.mod_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_moderator();
  return coalesce((
    select jsonb_agg(c order by c.priority desc, c.rating desc nulls last)
    from (
      select p.username,
        (select max(round(r.rating))::int from public.ratings r where r.user_id = p.user_id and r.kind in ('lightning', 'blitz', 'rapid')) as rating,
        (select max(f.score) from public.fairplay f where f.user_id = p.user_id) as score,
        (select f.verdict from public.fairplay f where f.user_id = p.user_id order by case f.verdict when 'likely' then 2 when 'watch' then 1 else 0 end desc limit 1) as verdict,
        (select count(*) from public.reports r where r.suspect = p.user_id and r.status = 'open') as reports,
        (select coalesce(sum((public.reporter_record(r.reporter)->>'weight')::numeric), 0) from public.reports r where r.suspect = p.user_id and r.status = 'open') as weight,
        (select count(*) from public.games g where p.user_id in (g.red, g.black) and g.fairplay->>'status' in ('disagree', 'missing')) as unchecked,
        coalesce((select max(f.score) from public.fairplay f where f.user_id = p.user_id), 0)
          + 3 * (select coalesce(sum((public.reporter_record(r.reporter)->>'weight')::numeric), 0) from public.reports r where r.suspect = p.user_id and r.status = 'open')
          + (select count(*) from public.games g where p.user_id in (g.red, g.black) and g.fairplay->>'status' in ('disagree', 'missing'))
          + case when exists (select 1 from public.fairplay f where f.user_id = p.user_id and f.verdict = 'likely') then 10 else 0 end as priority
      from public.profiles p
      where exists (select 1 from public.reports r where r.suspect = p.user_id and r.status = 'open')
         or exists (select 1 from public.fairplay f where f.user_id = p.user_id and f.verdict in ('watch', 'likely'))
         or exists (select 1 from public.games g where p.user_id in (g.red, g.black) and g.fairplay->>'status' in ('disagree', 'missing'))
    ) c), '[]'::jsonb);
end $$;

/**
 * One case for the review page: the player's ratings, standing per speed, sanctions, the
 * reports with their reporters' records, and their recent rated games with each check (the
 * player's side), moves for games still to check, and the moderator log about them.
 */
create function public.mod_case(p_username text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid;
begin
  perform public.require_moderator();
  select user_id into u from public.profiles where lower(username) = lower(p_username);
  if u is null then return null; end if;
  return jsonb_build_object(
    'username', (select username from public.profiles where user_id = u),
    'created_at', (select created_at from auth.users where id = u),
    'report_barred', (select report_barred from public.profiles where user_id = u),
    'reporter', public.reporter_record(u),
    'completion', public.completion_of(u),
    'checked_games', public.checked_games_of(u),
    'ratings', coalesce((select jsonb_object_agg(r.kind, jsonb_build_object('rating', round(r.rating), 'rd', round(r.rd), 'games', r.games))
      from public.ratings r where r.user_id = u and r.kind in ('lightning', 'blitz', 'rapid')), '{}'::jsonb),
    'standing', coalesce((select jsonb_object_agg(f.speed, jsonb_build_object('games', f.games, 'score', f.score, 'far', f.far, 'verdict', f.verdict))
      from public.fairplay f where f.user_id = u), '{}'::jsonb),
    'sanctions', coalesce((select jsonb_agg(to_jsonb(s) - 'user_id' order by s.created_at desc) from public.sanctions s where s.user_id = u), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'game', r.game_id, 'reason', r.reason, 'note', r.note, 'at', r.created_at, 'status', r.status,
        'reporter', rp.username, 'record', public.reporter_record(r.reporter)) order by r.created_at desc)
      from public.reports r join public.profiles rp on rp.user_id = r.reporter where r.suspect = u), '[]'::jsonb),
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'speed', g.speed, 'base', g.base, 'inc', g.inc, 'color', case when g.red = u then 'red' else 'black' end,
        'opponent', op.username, 'result', g.result, 'reason', g.reason, 'plies', coalesce(array_length(g.moves, 1), 0), 'ended_at', g.ended_at,
        'rating_before', case when g.red = u then g.red_rating_before else g.black_rating_before end,
        'status', g.fairplay->>'status',
        'check', g.fairplay->(case when g.red = u then 'red' else 'black' end),
        'labels', public.labels_of(g, u),
        'moves', case when coalesce(g.fairplay->>'status', 'none') <> 'checked' then to_jsonb(g.moves) end
      ) order by g.ended_at desc)
      from (select * from public.games g0 where u in (g0.red, g0.black) and g0.status = 'over' and g0.rated order by g0.ended_at desc limit 30) g
      left join public.profiles op on op.user_id = case when g.red = u then g.black else g.red end), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(jsonb_build_object('at', l.at, 'action', l.action, 'details', l.details, 'moderator', mp.username) order by l.at desc)
      from public.mod_log l left join public.profiles mp on mp.user_id = l.moderator where l.target = u), '[]'::jsonb));
end $$;

/** No violation found: the open reports are dismissed and the player's standing starts afresh. */
create function public.mod_dismiss(p_username text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
  sp text;
begin
  perform public.require_moderator();
  select user_id into u from public.profiles where lower(username) = lower(p_username);
  if u is null then raise exception 'no such player' using errcode = 'P0002'; end if;
  update public.reports set status = 'dismissed', decided_at = now() where suspect = u and status = 'open';
  update public.profiles set fairplay_cleared_at = now() where user_id = u;
  for sp in select speed from public.fairplay where user_id = u loop
    perform public.update_fairplay_player(u, sp);
  end loop;
  perform public.log_mod_action('dismiss', u, jsonb_build_object('note', p_note));
end $$;

/**
 * A violation confirmed. The first: rated online play suspended 30 days, ratings reset to a new
 * player's, a public mark for a year. A second: all online play suspended, closed if no appeal
 * succeeds in 30 days. Either way the open reports are upheld (reporters told), and opponents
 * get back the rating they lost to the player in the last 3 months (up to 100 games).
 */
create function public.mod_confirm(p_username text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
  lvl int;
  sanction bigint;
  refunded int := 0;
  g record;
  amount int;
  victim uuid;
begin
  perform public.require_moderator();
  select user_id into u from public.profiles where lower(username) = lower(p_username);
  if u is null then raise exception 'no such player' using errcode = 'P0002'; end if;
  lvl := case when exists (select 1 from public.sanctions s where s.user_id = u and s.overturned_at is null) then 2 else 1 end;
  insert into public.sanctions (user_id, level, reason, suspended_until, public_until, appeal_deadline, moderator)
  values (u, lvl, 'fair-play', case when lvl = 1 then now() + interval '30 days' end, now() + interval '1 year', now() + interval '30 days', auth.uid())
  returning id into sanction;

  -- Refunds: what each opponent lost (or failed to gain in a draw) against the player.
  for g in
    select * from public.games x
    where u in (x.red, x.black) and x.rated and x.status = 'over' and x.ended_at > now() - interval '3 months'
      and x.red_rating_before is not null and x.black_rating_before is not null
    order by x.ended_at desc limit 100
  loop
    victim := case when g.red = u then g.black else g.red end;
    amount := case when g.red = u then g.black_rating_before - g.black_rating_after else g.red_rating_before - g.red_rating_after end;
    if victim is not null and amount > 0 then
      update public.ratings set rating = rating + amount where user_id = victim and kind = g.speed;
      insert into public.refunds (user_id, game_id, sanction_id, speed, amount) values (victim, g.id, sanction, g.speed, amount);
      refunded := refunded + 1;
    end if;
  end loop;
  insert into public.notices (user_id, kind, data)
  select r.user_id, 'refund', jsonb_build_object('points', sum(r.amount), 'games', count(*))
  from public.refunds r where r.sanction_id = sanction group by r.user_id;

  -- The player's ratings start again, as a new player's.
  if lvl = 1 then
    update public.ratings set rating = coalesce((select b.rating from public.ratings b where b.user_id = u and b.kind = 'bot'), 800), rd = 200, games = 0
    where user_id = u and kind in ('lightning', 'blitz', 'rapid');
  end if;

  update public.reports set status = 'upheld', decided_at = now() where suspect = u and status = 'open';
  insert into public.notices (user_id, kind) select distinct r.reporter, 'report-upheld' from public.reports r where r.suspect = u and r.decided_at = now() and r.status = 'upheld';
  insert into public.notices (user_id, kind, data) values (u, 'sanction', jsonb_build_object('level', lvl));
  perform public.log_mod_action('confirm', u, jsonb_build_object('note', p_note, 'level', lvl, 'sanction', sanction, 'refunded_games', refunded));
  return jsonb_build_object('level', lvl, 'sanction', sanction, 'refunded_games', refunded);
end $$;

/**
 * Records an appeal (they arrive by email): 'pending' when received (a level-2 closure then
 * waits for the decision), 'upheld' if the sanction stands, 'overturned' to lift it.
 */
create function public.mod_appeal(p_sanction bigint, p_state text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.sanctions;
begin
  perform public.require_moderator();
  if p_state not in ('pending', 'upheld', 'overturned') then raise exception 'bad appeal state' using errcode = '22023'; end if;
  select * into s from public.sanctions where id = p_sanction;
  if not found then raise exception 'no such sanction' using errcode = 'P0002'; end if;
  update public.sanctions set appeal = p_state, overturned_at = case when p_state = 'overturned' then now() end where id = p_sanction;
  if p_state <> 'pending' then
    insert into public.notices (user_id, kind, data) values (s.user_id, 'appeal', jsonb_build_object('outcome', p_state));
  end if;
  perform public.log_mod_action('appeal-' || p_state, s.user_id, jsonb_build_object('note', p_note, 'sanction', p_sanction));
end $$;

/** Takes away (or gives back) the right to report, for persistent false reporting. */
create function public.mod_bar_reporter(p_username text, p_barred boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
begin
  perform public.require_moderator();
  update public.profiles set report_barred = p_barred where lower(username) = lower(p_username) returning user_id into u;
  if u is null then raise exception 'no such player' using errcode = 'P0002'; end if;
  perform public.log_mod_action(case when p_barred then 'bar-reporter' else 'unbar-reporter' end, u, jsonb_build_object('note', p_note));
end $$;

/** The latest moderator actions, newest first. */
create function public.mod_log_recent(p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_moderator();
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', l.at, 'action', l.action, 'details', l.details, 'moderator', mp.username, 'target', tp.username) order by l.at desc)
    from (select * from public.mod_log order by at desc limit least(p_limit, 200)) l
    left join public.profiles mp on mp.user_id = l.moderator
    left join public.profiles tp on tp.user_id = l.target), '[]'::jsonb);
end $$;

-- A moderator's own analysis settles a game whose check is missing or disputed (the `game`
-- function calls this when the sender is a moderator).
create function public.is_moderator_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_moderator(p_user)
$$;

-- Access ----------------------------------------------------------------------------------

revoke all on function public.is_moderator(uuid), public.require_moderator(), public.mod_log_append_only(), public.log_mod_action(text, uuid, jsonb),
  public.my_notices(), public.dismiss_notice(bigint), public.reporter_record(uuid), public.report_player(uuid, text, text), public.reported_game(uuid),
  public.active_sanction(uuid), public.public_mark(uuid), public.seeks_mark_finding(), public.on_leaderboard(uuid, text), public.leaderboard(text),
  public.mod_queue(), public.mod_case(text), public.mod_dismiss(text, text), public.mod_confirm(text, text), public.mod_appeal(bigint, text, text),
  public.mod_bar_reporter(text, boolean, text), public.mod_log_recent(int), public.is_moderator_user(uuid)
  from public, anon, authenticated;
grant execute on function public.is_moderator(uuid), public.my_notices(), public.dismiss_notice(bigint), public.report_player(uuid, text, text),
  public.reported_game(uuid), public.mod_queue(), public.mod_case(text), public.mod_dismiss(text, text), public.mod_confirm(text, text),
  public.mod_appeal(bigint, text, text), public.mod_bar_reporter(text, boolean, text), public.mod_log_recent(int) to authenticated;
grant execute on function public.leaderboard(text) to anon, authenticated;
grant execute on function public.is_moderator_user(uuid) to service_role;
