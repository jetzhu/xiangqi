-- M20, third step from the load test: the report worker topped out at 200 reports a run (40 a
-- second, reached by about 60 games at once), every processed report was also kept in the
-- queue's archive (more space than the game log itself, never cleared), and each report row of
-- the game log cost about 0.3 KB.
-- - The worker works set-wise in batches of 500 and keeps going for up to 4 seconds a run.
-- - Processed reports are deleted from the queue: the game log already keeps every one.
-- - Once a game is past the 7 days in which it can be reported or analysed, its log rows are
--   packed into one value on the game, a third of the size.

create or replace function public.process_game_reports(p_batch int default 500)
returns int language plpgsql security definer set search_path = '' as $$
declare
  n int := 0;
  got int;
  ids bigint[];
  started timestamptz := clock_timestamp();
begin
  loop
    with msgs as (
      select m.msg_id, (m.message->>'game')::uuid as game, m.message->>'by' as by_color, m.message->'report' as report, (m.message->>'at')::timestamptz as at
      from pgmq.read('game_reports', 30, p_batch) m
    ), logged as (
      insert into public.game_log (game_id, by_color, kind, ply, report, at)
      select x.game, x.by_color, x.report->>'kind', (x.report->>'ply')::int, x.report, x.at
      from msgs x where exists (select 1 from public.games g where g.id = x.game)
      order by x.msg_id
    ), touched as (
      update public.games g set
        last_report_at = greatest(g.last_report_at, x.at),
        red_end = coalesce(x.red_end, g.red_end),
        black_end = coalesce(x.black_end, g.black_end)
      from (
        select game, max(at) as at,
          (array_agg(report order by msg_id desc) filter (where report->>'kind' = 'end' and by_color = 'red'))[1] as red_end,
          (array_agg(report order by msg_id desc) filter (where report->>'kind' = 'end' and by_color = 'black'))[1] as black_end
        from msgs group by game
      ) x
      where g.id = x.game
    )
    select array_agg(msg_id), count(*) into ids, got from msgs;
    if got > 0 then perform pgmq.delete('game_reports', ids); end if;
    n := n + got;
    exit when got < p_batch or clock_timestamp() - started > interval '4 seconds';
  end loop;

  update public.games g set status = 'over', ended_at = now(),
    result = case when g.red_end is null and g.black_end is null and moved.n >= 2 then 'draw' else 'none' end,
    reason = case when g.red_end is not null or g.black_end is not null then 'no-result' when moved.n < 2 then 'aborted' else 'both-away' end
  from (select g2.id, (select count(distinct l.ply) from public.game_log l where l.game_id = g2.id and l.kind = 'move') as n
        from public.games g2 where g2.status = 'playing' and g2.last_report_at < now() - interval '10 minutes') moved
  where g.id = moved.id;
  return n;
end $$;

-- The archive held a second copy of every report the game log already has.
do $$
begin
  if to_regclass('pgmq.a_game_reports') is not null then
    execute 'truncate pgmq.a_game_reports';
  end if;
end $$;

-- Packed game logs ------------------------------------------------------------------------------

-- The game log of a game more than 8 days over, as one array: [{by, kind, ply, report, at}, …].
alter table public.games add column log_packed jsonb;

/** Packs the log rows of games over for more than 8 days (past reports and analyses) into one value each. */
create function public.pack_game_logs(p_limit int default 2000)
returns int language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  with old as (
    select g.id from public.games g
    where g.status = 'over' and g.ended_at < now() - interval '8 days' and g.log_packed is null
      and exists (select 1 from public.game_log l where l.game_id = g.id)
    limit p_limit
  ), packed as (
    update public.games g set log_packed = (
      select jsonb_agg(jsonb_build_object('by', l.by_color, 'kind', l.kind, 'ply', l.ply, 'report', l.report, 'at', l.at) order by l.id)
      from public.game_log l where l.game_id = g.id)
    from old where g.id = old.id
    returning g.id
  )
  delete from public.game_log l using packed where l.game_id = packed.id;
  get diagnostics n = row_count;
  return n;
end $$;

-- Deleting records after 12 months covers packed logs too.
create or replace function public.purge_old_game_records()
returns int language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  with old as (
    select g.id from public.games g
    where g.status = 'over' and g.ended_at < now() - interval '12 months'
      and (g.red_end is not null or g.black_end is not null or g.log_packed is not null
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
  update public.games g set red_end = null, black_end = null, log_packed = null from old where g.id = old.id;
  get diagnostics n = row_count;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('pack-game-logs', '29 3 * * *', 'select public.pack_game_logs()');
  end if;
end $$;

revoke all on function public.pack_game_logs(int) from public, anon, authenticated;
