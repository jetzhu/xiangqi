-- M11: small per-player records that follow the account between devices, one row per kind:
--   stars     {botId: 1..3}      best stars per bot (until M12 derives crowns from bot_games)
--   rush      {mode: score}      best Puzzle Rush score per mode
--   activity  ["YYYY-MM-DD", …]  days with a game, puzzle or finished lesson (the streak)
--   daily     ["YYYY-MM-DD", …]  days the daily puzzle was solved
-- Each device sends its whole value; the database merges it with what is there (best per key,
-- or the union of days), so two devices can't undo each other's progress.

create table public.player_state (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (key in ('stars', 'rush', 'activity', 'daily')),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key),
  check (jsonb_typeof(value) = case when key in ('stars', 'rush') then 'object' else 'array' end),
  check (pg_column_size(value) <= 16384)
);

create function public.player_state_merge()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.user_id := old.user_id;
  new.key := old.key;
  new.updated_at := now();
  if new.key in ('stars', 'rush') then
    select coalesce(jsonb_object_agg(k, to_jsonb(v)), '{}') into new.value
    from (
      select k, max(v::numeric) as v
      from (select key as k, value as v from jsonb_each(old.value)
            union all
            select key, value from jsonb_each(new.value)) both_values
      group by k
    ) best;
  else
    -- Days as sorted text, newest 400 kept.
    select coalesce(jsonb_agg(d order by d), '[]') into new.value
    from (
      select d from (select jsonb_array_elements_text(old.value) as d
                     union
                     select jsonb_array_elements_text(new.value)) days
      order by d desc limit 400
    ) newest;
  end if;
  return new;
end
$$;
create trigger player_state_merge before update on public.player_state
  for each row execute function public.player_state_merge();

alter table public.player_state enable row level security;
revoke all on public.player_state from anon, authenticated;
grant select, insert, update, delete on public.player_state to authenticated;
create policy "own player state" on public.player_state for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
