-- After M19: a third decision, "not conclusive"; a case leaves the queue after any decision and
-- returns only with new evidence; each reporter counts once per suspect; the chat both browsers
-- recorded shown with each game; and how long game records are kept.

-- The last decision on each player's case, so the queue can tell new evidence from old.
create table public.case_reviews (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reviewed_at timestamptz not null,
  outcome text not null check (outcome in ('no-violation', 'inconclusive', 'violation')),
  -- The strongest standing at the time, so a worse one later counts as new evidence.
  verdict text,
  note text,
  moderator uuid references auth.users (id) on delete set null
);
alter table public.case_reviews enable row level security;
revoke all on public.case_reviews from anon, authenticated;

/** 0 normal, 1 watch, 2 likely: the player's strongest standing at any speed. */
create function public.verdict_rank(p_user uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(max(case f.verdict when 'likely' then 2 when 'watch' then 1 else 0 end), 0) from public.fairplay f where f.user_id = p_user
$$;

-- Every decision in the log is also the case's last review.
create function public.mod_log_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.action in ('dismiss', 'inconclusive', 'confirm') and new.target is not null then
    insert into public.case_reviews (user_id, reviewed_at, outcome, verdict, note, moderator)
    values (new.target, new.at, case new.action when 'dismiss' then 'no-violation' when 'confirm' then 'violation' else 'inconclusive' end,
            (array['normal', 'watch', 'likely'])[public.verdict_rank(new.target) + 1], new.details->>'note', new.moderator)
    on conflict (user_id) do update set reviewed_at = excluded.reviewed_at, outcome = excluded.outcome, verdict = excluded.verdict,
      note = excluded.note, moderator = excluded.moderator;
  end if;
  return new;
end $$;
create trigger mod_log_review after insert on public.mod_log for each row execute function public.mod_log_review();

/**
 * Not enough evidence either way: the reports stay open (reporters' records unchanged), the
 * player's standing keeps counting every game, and the case returns with new evidence.
 */
create function public.mod_inconclusive(p_username text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
begin
  perform public.require_moderator();
  select user_id into u from public.profiles where lower(username) = lower(p_username);
  if u is null then raise exception 'no such player' using errcode = 'P0002'; end if;
  perform public.log_mod_action('inconclusive', u, jsonb_build_object('note', p_note));
end $$;

/** Evidence on a player that arrived after `p_since`: a report, a newly checked or unsettled game, or a worse standing. */
create function public.new_evidence(p_user uuid, p_since timestamptz, p_verdict text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reports r where r.suspect = p_user and r.status = 'open' and r.created_at > p_since)
    or exists (select 1 from public.games g where p_user in (g.red, g.black) and (g.fairplay->>'at')::timestamptz > p_since
               and (g.fairplay->>'status' in ('disagree', 'missing')
                    or (g.fairplay->>'status' = 'checked' and g.fairplay->(case when g.red = p_user then 'red' else 'black' end)->>'z' is not null)))
    or public.verdict_rank(p_user) > case p_verdict when 'likely' then 2 when 'watch' then 1 else 0 end
$$;

/** The open reports' weight, each reporter counted once: two people are stronger evidence than one person twice. */
create function public.report_weight(p_user uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum((public.reporter_record(x.reporter)->>'weight')::numeric), 0)
  from (select distinct r.reporter from public.reports r where r.suspect = p_user and r.status = 'open') x
$$;

/**
 * The review queue, as in M19, with two changes: each reporter counts once, and a case already
 * decided waits until new evidence arrives ("returning", with the last decision's note).
 */
create or replace function public.mod_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_moderator();
  return coalesce((
    select jsonb_agg(c order by c.priority desc, c.rating desc nulls last)
    from (
      select p.username,
        (select max(round(r.rating))::int from public.ratings r where r.user_id = p.user_id and r.kind in ('lightning', 'blitz', 'rapid')) as rating,
        (select max(f.score) from public.fairplay f where f.user_id = p.user_id) as score,
        (array['normal', 'watch', 'likely'])[public.verdict_rank(p.user_id) + 1] as verdict,
        (select count(distinct r.reporter) from public.reports r where r.suspect = p.user_id and r.status = 'open') as reports,
        public.report_weight(p.user_id) as weight,
        (select count(*) from public.games g where p.user_id in (g.red, g.black) and g.fairplay->>'status' in ('disagree', 'missing')) as unchecked,
        cr.outcome as last_outcome,
        cr.note as last_note,
        cr.reviewed_at as last_reviewed,
        coalesce((select max(f.score) from public.fairplay f where f.user_id = p.user_id), 0)
          + 3 * public.report_weight(p.user_id)
          + (select count(*) from public.games g where p.user_id in (g.red, g.black) and g.fairplay->>'status' in ('disagree', 'missing'))
          + case when public.verdict_rank(p.user_id) = 2 then 10 else 0 end as priority
      from public.profiles p
      left join public.case_reviews cr on cr.user_id = p.user_id
      where (exists (select 1 from public.reports r where r.suspect = p.user_id and r.status = 'open')
          or public.verdict_rank(p.user_id) > 0
          or exists (select 1 from public.games g where p.user_id in (g.red, g.black) and g.fairplay->>'status' in ('disagree', 'missing')))
        and (cr.user_id is null or public.new_evidence(p.user_id, cr.reviewed_at, cr.verdict))
    ) c), '[]'::jsonb);
end $$;

-- The case, with its last decision and each game's chat as both browsers recorded it. The M19
-- case is kept as it is and extended here.
alter function public.mod_case(text) rename to mod_case_base;
revoke all on function public.mod_case_base(text) from public, anon, authenticated;

create function public.mod_case(p_username text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  base jsonb := public.mod_case_base(p_username);
  u uuid;
begin
  if base is null then return null; end if;
  select user_id into u from public.profiles where lower(username) = lower(p_username);
  return base || jsonb_build_object(
    'review', (select jsonb_build_object('outcome', cr.outcome, 'at', cr.reviewed_at, 'note', cr.note) from public.case_reviews cr where cr.user_id = u),
    'games', coalesce((
      select jsonb_agg(gm || jsonb_build_object('chat', (
        select case when g.red_end ? 'chat' or g.black_end ? 'chat'
          then jsonb_build_object('red', g.red_end->'chat', 'black', g.black_end->'chat') end
        from public.games g where g.id = (gm->>'id')::uuid)))
      from jsonb_array_elements(base->'games') gm), '[]'::jsonb));
end $$;

-- How long game records are kept -------------------------------------------------------------

-- Each game's detailed record (the per-move log, both browsers' analyses and end reports with
-- their chat) is kept for 12 months, and longer while either player has an open report, an
-- inconclusive case, or a sanction whose appeal is pending or still possible. The game itself
-- (players, moves, result, ratings, its check) stays.
create function public.purge_old_game_records()
returns int language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  with old as (
    select g.id from public.games g
    where g.status = 'over' and g.ended_at < now() - interval '12 months'
      and (g.red_end is not null or g.black_end is not null
           or exists (select 1 from public.game_log l where l.game_id = g.id)
           or exists (select 1 from public.game_analysis a where a.game_id = g.id))
      and not exists (
        select 1 from unnest(array[g.red, g.black]) p(u)
        where exists (select 1 from public.reports r where r.suspect = p.u and r.status = 'open')
           or exists (select 1 from public.case_reviews cr where cr.user_id = p.u and cr.outcome = 'inconclusive')
           or exists (select 1 from public.sanctions s where s.user_id = p.u and s.overturned_at is null
                      and (s.appeal = 'pending' or s.appeal_deadline > now())))
    limit 500
  ), gone_log as (
    delete from public.game_log l using old where l.game_id = old.id
  ), gone_analysis as (
    delete from public.game_analysis a using old where a.game_id = old.id
  )
  update public.games g set red_end = null, black_end = null from old where g.id = old.id;
  get diagnostics n = row_count;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('purge-old-game-records', '23 3 * * *', 'select public.purge_old_game_records()');
  end if;
end $$;

-- Access ----------------------------------------------------------------------------------

revoke all on function public.verdict_rank(uuid), public.mod_log_review(), public.mod_inconclusive(text, text),
  public.new_evidence(uuid, timestamptz, text), public.report_weight(uuid), public.mod_case(text), public.purge_old_game_records()
  from public, anon, authenticated;
grant execute on function public.mod_inconclusive(text, text), public.mod_case(text) to authenticated;
