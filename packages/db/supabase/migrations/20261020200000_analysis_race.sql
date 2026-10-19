-- M20, fourth step from the load test: two findings when 100 games ended at once.
-- - Both browsers often send their analysis at the same moment; each save then missed the
--   other's and the game stayed "one" analysis, never checked (2 games in 100). Saves for a game
--   now take turns.
-- - The `game` function runs the report worker before settling a game; with the worker now
--   going for up to 4 seconds a run, settling waited too. The function asks for one batch.

create or replace function public.save_analysis(p_game uuid, p_by text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  -- The second save waits here for the first, then sees it.
  perform 1 from public.games where id = p_game for update;
  insert into public.game_analysis (game_id, by_color, data) values (p_game, p_by, p_data)
  on conflict (game_id, by_color) do update set data = excluded.data, created_at = now();
  return (select coalesce(jsonb_object_agg(by_color, data), '{}'::jsonb) from public.game_analysis where game_id = p_game);
end $$;

-- The worker's time budget: 4 seconds for the scheduled run, 0 (one batch) for the `game` function.
drop function public.process_game_reports(int);
create function public.process_game_reports(p_batch int default 500, p_seconds numeric default 4)
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
    exit when got < p_batch or clock_timestamp() - started > make_interval(secs => p_seconds);
  end loop;

  update public.games g set status = 'over', ended_at = now(),
    result = case when g.red_end is null and g.black_end is null and moved.n >= 2 then 'draw' else 'none' end,
    reason = case when g.red_end is not null or g.black_end is not null then 'no-result' when moved.n < 2 then 'aborted' else 'both-away' end
  from (select g2.id, (select count(distinct l.ply) from public.game_log l where l.game_id = g2.id and l.kind = 'move') as n
        from public.games g2 where g2.status = 'playing' and g2.last_report_at < now() - interval '10 minutes') moved
  where g.id = moved.id;
  return n;
end $$;

revoke all on function public.process_game_reports(int, numeric) from public, anon, authenticated;
grant execute on function public.process_game_reports(int, numeric) to service_role;
