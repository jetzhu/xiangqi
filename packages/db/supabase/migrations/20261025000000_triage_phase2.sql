-- Report triage, phase 2 (2026-10-21, docs/v0.4-design.md "Moderation that runs itself"): a
-- confident verdict from the rules or an AI adviser acts on its own, with private, reversible
-- steps only: closing the report, pausing the suspect's chat for 7 days, or hiding an offensive
-- username until the player chooses another. Every step goes on a review list that a moderator
-- keeps or undoes when they have time; a category whose steps are undone too often switches
-- itself off. Anything public (a mark, a suspension, refunds), second offences, engine findings
-- and appeals stay with a person. A daily summary (written by packages/triage) is kept for the
-- review page.

-- A report closed by triage is out of the queue but not decided: it counts for or against the
-- reporter only once a moderator keeps the step.
alter table public.reports drop constraint reports_status_check;
alter table public.reports add constraint reports_status_check check (status in ('open', 'upheld', 'dismissed', 'auto-closed'));

create or replace function public.reporter_record(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'made', count(*) filter (where r.status in ('upheld', 'dismissed')),
    'upheld', count(*) filter (where r.status = 'upheld'),
    'weight', case
      when (select report_barred from public.profiles where user_id = p_user) then 0
      when exists (select 1 from public.sanctions s where s.user_id = p_user and s.overturned_at is null) then 0
      else round((count(*) filter (where r.status = 'upheld') + 1.0) / (count(*) filter (where r.status in ('upheld', 'dismissed')) + 2.0), 2) end)
  from public.reports r where r.reporter = p_user
$$;

alter table public.notices drop constraint notices_kind_check;
alter table public.notices add constraint notices_kind_check check (kind in ('report-upheld', 'refund', 'sanction', 'appeal', 'chat-muted', 'username-hidden'));

-- Switched on at the owner's request (2026-10-21); 'other' lets an adviser close a report it
-- finds clearly unfounded. The steps' size and the confidence they need.
update public.triage_config set value = 1 where key in ('auto_stalling', 'auto_chat', 'auto_engine', 'auto_username');
insert into public.triage_config (key, value) values ('auto_other', 1), ('auto_min_confidence', 0.8), ('mute_days', 7);

create table public.auto_actions (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- 'rules', or an adviser such as 'ai:claude-code'.
  source text not null,
  kind text not null check (kind in ('close-report', 'mute-chat', 'hide-username')),
  -- The report's reason; the switch and the self switch-off go by it.
  category text not null,
  report_id bigint references public.reports (id) on delete set null,
  target uuid not null references auth.users (id) on delete cascade,
  verdict text not null check (verdict in ('valid', 'invalid')),
  confidence numeric not null,
  reason text not null,
  -- What undoing needs: the hidden username and its placeholder, the mute's end.
  details jsonb not null default '{}',
  review text check (review in ('kept', 'undone')),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  review_note text
);
create index auto_actions_pending on public.auto_actions (at) where review is null;
create index auto_actions_target on public.auto_actions (target, kind, at desc);
alter table public.auto_actions enable row level security;
revoke all on public.auto_actions from anon, authenticated;

-- Players whose chat is paused: their phrases aren't sent or shown (both browsers read it from game_info).
create table public.chat_mutes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  until timestamptz not null,
  action_id bigint references public.auto_actions (id) on delete set null
);
alter table public.chat_mutes enable row level security;
revoke all on public.chat_mutes from anon, authenticated;

/** When a player's chat is paused until, or null. */
create function public.chat_muted_until(p_user uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select until from public.chat_mutes where user_id = p_user and until > now()
$$;

-- Hiding a username, or giving it back, is the server's doing: inside those steps (and only
-- there, never from the browser) the profile takes the name and the "chosen" flag as given.
create or replace function public.profiles_before_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  if current_setting('xq.moderation', true) = 'on' and current_user not in ('authenticated', 'anon') then
    new.username_changed_at := old.username_changed_at;
    return new;
  end if;
  if new.username is distinct from old.username then
    if old.username_chosen and old.username_changed_at is not null and old.username_changed_at > now() - interval '90 days' then
      raise exception 'username can be changed once every 90 days' using errcode = 'P0001', hint = 'too_soon';
    end if;
    if public.username_problem(new.username, old.user_id) is not null then
      raise exception 'username not allowed: %', public.username_problem(new.username, old.user_id)
        using errcode = 'P0001', hint = public.username_problem(new.username, old.user_id);
    end if;
    -- Replacing the placeholder is choosing a name, not changing one.
    new.username_changed_at := case when old.username_chosen then now() else old.username_changed_at end;
    new.username_chosen := true;
  else
    new.username_changed_at := old.username_changed_at;
    new.username_chosen := old.username_chosen;
  end if;
  return new;
end
$$;

/**
 * Lets one source's verdict on a report act, if it may: the report is open, the verdict is
 * confident, its category's switch is on, and for an adviser the rules don't say the opposite.
 * - likely invalid: the report is closed;
 * - likely valid: stalling is closed (the game's marks already count), abusive chat pauses chat,
 *   an offensive username is hidden; engine and "other" findings go to a person;
 * - a second offence (an earlier step of the same kind that was kept, or a sanction in the last
 *   180 days) goes to a person, while more reports about the same episode (a step of the same
 *   kind in the 7 days before the report) are just closed.
 * Returns the step's id, or null when it doesn't act.
 */
create function public.triage_auto_act(p_report bigint, p_source text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  r public.reports;
  v public.report_triage;
  ru public.report_triage;
  step text;
  why text;
  info jsonb := '{}';
  act bigint;
  old_name text;
  new_name text;
  mute_until timestamptz;
begin
  select * into r from public.reports where id = p_report for update;
  if not found or r.status <> 'open' then return null; end if;
  select * into v from public.report_triage where report_id = p_report and source = p_source;
  if not found or v.verdict = 'inconclusive' or v.confidence < public.triage_value('auto_min_confidence') then return null; end if;
  if coalesce(public.triage_value('auto_' || r.reason), 0) < 1 then return null; end if;
  if p_source <> 'rules' then
    select * into ru from public.report_triage where report_id = p_report and source = 'rules';
    if found and ru.verdict <> 'inconclusive' and ru.verdict <> v.verdict then return null; end if;
  end if;
  why := v.reason;

  if v.verdict = 'invalid' then
    step := 'close-report';
  else
    step := case r.reason when 'stalling' then 'close-report' when 'chat' then 'mute-chat' when 'username' then 'hide-username' end;
    if step is null then return null; end if;
    if step <> 'close-report' then
      if exists (select 1 from public.auto_actions a where a.target = r.suspect and a.kind = step
                 and a.review is distinct from 'undone' and a.at > r.created_at - interval '7 days') then
        step := 'close-report';
        why := 'Same episode as an earlier automatic step. ' || why;
      elsif exists (select 1 from public.auto_actions a where a.target = r.suspect and a.kind = step and a.review = 'kept')
         or exists (select 1 from public.sanctions s where s.user_id = r.suspect and s.overturned_at is null and s.created_at > now() - interval '180 days') then
        return null;
      end if;
    end if;
  end if;

  if step = 'mute-chat' then
    mute_until := now() + make_interval(days => public.triage_value('mute_days')::int);
    info := jsonb_build_object('until', mute_until);
  elsif step = 'hide-username' then
    select username into old_name from public.profiles where user_id = r.suspect;
    loop
      new_name := 'player-' || (1000000 + floor(random() * 9000000))::int;
      exit when public.username_problem(new_name) is null;
    end loop;
    info := jsonb_build_object('old', old_name, 'new', new_name);
  end if;

  insert into public.auto_actions (source, kind, category, report_id, target, verdict, confidence, reason, details)
  values (p_source, step, r.reason, r.id, r.suspect, v.verdict, v.confidence, left(why, 500), info)
  returning id into act;
  update public.reports set status = 'auto-closed', decided_at = now() where id = r.id;

  if step = 'mute-chat' then
    insert into public.chat_mutes (user_id, until, action_id) values (r.suspect, mute_until, act)
    on conflict (user_id) do update set until = greatest(public.chat_mutes.until, excluded.until), action_id = excluded.action_id;
    insert into public.notices (user_id, kind, data) values (r.suspect, 'chat-muted', jsonb_build_object('until', mute_until, 'action', act));
  elsif step = 'hide-username' then
    -- The first choice after a placeholder doesn't wait 90 days; the old name stays reserved.
    perform set_config('xq.moderation', 'on', true);
    update public.profiles set username = new_name, username_chosen = false where user_id = r.suspect;
    perform set_config('xq.moderation', '', true);
    insert into public.reserved_usernames (name) values (lower(old_name)) on conflict do nothing;
    insert into public.notices (user_id, kind, data) values (r.suspect, 'username-hidden', jsonb_build_object('action', act));
  end if;
  insert into public.mod_log (moderator, action, target, details)
  values (null, 'auto:' || step, r.suspect, jsonb_build_object('source', p_source, 'report', r.id, 'step', act, 'note', why));
  return act;
end $$;

-- The rules act as soon as they've judged (when a report is made, and hourly as evidence arrives).
create or replace function public.triage_report(p_report bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := public.triage_rules(p_report);
begin
  if v is null then return; end if;
  insert into public.report_triage (report_id, source, verdict, confidence, rule, reason)
  values (p_report, 'rules', v->>'verdict', (v->>'confidence')::numeric, v->>'rule', v->>'reason')
  on conflict (report_id, source) do update set verdict = excluded.verdict, confidence = excluded.confidence,
    rule = excluded.rule, reason = excluded.reason, at = now();
  perform public.triage_auto_act(p_report, 'rules');
end $$;

-- An adviser's verdict acts too.
drop function public.save_triage_advice(bigint, text, text, numeric, text, text);
/** Stores an adviser's verdict on a report and lets it act; returns the step's id, or null. */
create function public.save_triage_advice(p_report bigint, p_source text, p_verdict text, p_confidence numeric, p_rule text, p_reason text)
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  insert into public.report_triage (report_id, source, verdict, confidence, rule, reason)
  values (p_report, p_source, p_verdict, least(1, greatest(0, p_confidence)), left(p_rule, 80), left(p_reason, 500))
  on conflict (report_id, source) do update set verdict = excluded.verdict, confidence = excluded.confidence,
    rule = excluded.rule, reason = excluded.reason, at = now();
  return public.triage_auto_act(p_report, p_source);
end $$;

-- Reviewing the steps --------------------------------------------------------------------------

/**
 * The automatic steps: those waiting for a look (default), or the latest reviewed ones. Each with
 * the player, the report (reason, note, reporter, game) and what was done.
 */
create function public.mod_auto_actions(p_pending boolean default true, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_moderator();
  return coalesce((select jsonb_agg(x order by x.at desc) from (
    select a.id, a.at, a.source, a.kind, a.category, a.verdict, a.confidence, a.reason, a.details, a.review, a.reviewed_at, a.review_note,
      tp.username as target, r.id as report, r.note as report_note, rp.username as reporter, r.game_id as game, mp.username as reviewed_by
    from public.auto_actions a
    left join public.profiles tp on tp.user_id = a.target
    left join public.reports r on r.id = a.report_id
    left join public.profiles rp on rp.user_id = r.reporter
    left join public.profiles mp on mp.user_id = a.reviewed_by
    where case when p_pending then a.review is null else a.review is not null end
    order by case when p_pending then a.at end asc, a.reviewed_at desc
    limit least(greatest(p_limit, 1), 500)
  ) x), '[]'::jsonb);
end $$;

/** Each category's switch, its steps waiting for a look, and its last 20 reviewed steps. */
create function public.mod_triage_switches()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_moderator();
  return (select jsonb_agg(jsonb_build_object(
      'category', c, 'on', coalesce(public.triage_value('auto_' || c), 0) >= 1,
      'pending', (select count(*) from public.auto_actions a where a.category = c and a.review is null),
      'reviewed', (select count(*) from (select 1 from public.auto_actions a where a.category = c and a.review is not null order by a.reviewed_at desc limit 20) l),
      'undone', (select count(*) filter (where review = 'undone') from (select a.review from public.auto_actions a where a.category = c and a.review is not null order by a.reviewed_at desc limit 20) l))
    order by c)
    from unnest(array['chat', 'engine', 'other', 'stalling', 'username']) c);
end $$;

/** A moderator turns a category's automatic steps on or off (logged). */
create function public.mod_set_auto(p_category text, p_on boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_moderator();
  update public.triage_config set value = case when p_on then 1 else 0 end where key = 'auto_' || p_category;
  if not found then raise exception 'no such category' using errcode = '22023'; end if;
  perform public.log_mod_action(case when p_on then 'auto-on' else 'auto-off' end, null, jsonb_build_object('category', p_category, 'note', p_note));
end $$;

/**
 * A moderator keeps or undoes a step.
 * Keep: the report is decided (upheld for a valid verdict, with the usual notice to the reporter;
 * dismissed for an invalid one). Undo: the step is reversed (chat back on; the old username back
 * if the player hasn't chosen a new one) and the report opens again. Either way the step counts
 * in its source's agreement; if more than 1 in 10 of a category's last 20 reviewed steps were
 * undone (and at least 2), the category switches itself off.
 */
create function public.mod_review_auto(p_id bigint, p_keep boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.auto_actions;
  me uuid := public.require_moderator();
  n int;
  undone int;
begin
  select * into a from public.auto_actions where id = p_id for update;
  if not found then raise exception 'no such step' using errcode = 'P0002'; end if;
  if a.review is not null then raise exception 'already reviewed' using errcode = 'P0001'; end if;

  if p_keep then
    update public.reports set status = case when a.verdict = 'valid' then 'upheld' else 'dismissed' end, decided_at = now()
    where id = a.report_id and status = 'auto-closed';
    if a.verdict = 'valid' then
      insert into public.notices (user_id, kind) select r.reporter, 'report-upheld' from public.reports r where r.id = a.report_id;
    end if;
  else
    update public.reports set status = 'open', decided_at = null where id = a.report_id and status = 'auto-closed';
    if a.kind = 'mute-chat' then
      delete from public.chat_mutes where user_id = a.target and action_id = a.id;
    elsif a.kind = 'hide-username' then
      delete from public.reserved_usernames where name = lower(a.details->>'old');
      if exists (select 1 from public.profiles p where p.user_id = a.target and p.username = a.details->>'new' and not p.username_chosen)
         and public.username_problem(a.details->>'old', a.target) is null then
        perform set_config('xq.moderation', 'on', true);
        update public.profiles set username = a.details->>'old', username_chosen = true where user_id = a.target;
        perform set_config('xq.moderation', '', true);
      end if;
    end if;
    delete from public.notices where user_id = a.target and kind in ('chat-muted', 'username-hidden') and (data->>'action')::bigint = a.id;
  end if;

  update public.auto_actions set review = case when p_keep then 'kept' else 'undone' end, reviewed_at = now(), reviewed_by = me,
    review_note = nullif(left(trim(coalesce(p_note, '')), 500), '')
  where id = a.id;
  if a.report_id is not null then
    insert into public.triage_outcomes (report_id, source, category, predicted, decided, confidence)
    values (a.report_id, a.source, a.category, a.verdict, case when p_keep then a.verdict else 'undone' end, a.confidence)
    on conflict (report_id, source) do update set predicted = excluded.predicted, decided = excluded.decided, confidence = excluded.confidence, at = now();
  end if;
  perform public.log_mod_action(case when p_keep then 'auto-keep' else 'auto-undo' end, a.target,
    jsonb_build_object('step', a.id, 'kind', a.kind, 'note', p_note));

  select count(*), count(*) filter (where review = 'undone') into n, undone
  from (select x.review from public.auto_actions x where x.category = a.category and x.review is not null order by x.reviewed_at desc limit 20) l;
  if undone >= 2 and undone * 10 > n then
    update public.triage_config set value = 0 where key = 'auto_' || a.category and value <> 0;
    if found then
      insert into public.mod_log (moderator, action, target, details)
      values (null, 'auto-off', null, jsonb_build_object('category', a.category, 'note', format('%s of the last %s reviewed steps were undone', undone, n)));
    end if;
  end if;
end $$;

-- The daily summary ------------------------------------------------------------------------------

create table public.triage_digest (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  source text not null,
  summary text not null check (length(summary) <= 20000),
  stats jsonb not null default '{}'
);
alter table public.triage_digest enable row level security;
revoke all on public.triage_digest from anon, authenticated;

/**
 * What the summary covers, since the last one (or the last day): steps taken by kind and
 * source, steps waiting for a look, cases in the queue, categories that switched off, reports
 * made, and the feedback sent (its text, for grouping into themes; no usernames).
 */
create function public.triage_digest_input()
returns jsonb language sql stable security definer set search_path = '' as $$
  with since as (select coalesce((select max(at) from public.triage_digest), now() - interval '1 day') as t)
  select jsonb_build_object(
    'since', (select t from since),
    'steps', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'source', source, 'category', category, 'n', n)) from (
      select kind, source, category, count(*) as n from public.auto_actions, since where at > since.t group by 1, 2, 3) s), '[]'::jsonb),
    'waiting_review', (select count(*) from public.auto_actions where review is null),
    'oldest_waiting', (select min(at) from public.auto_actions where review is null),
    'open_reports', (select count(*) from public.reports where status = 'open'),
    'players_with_open_reports', (select count(distinct suspect) from public.reports where status = 'open'),
    'reports_made', (select count(*) from public.reports, since where created_at > since.t),
    'reports_per_day_30d', (select round(count(*) / 30.0, 1) from public.reports where created_at > now() - interval '30 days'),
    'switched_off', coalesce((select jsonb_agg(details) from public.mod_log, since where action = 'auto-off' and at > since.t), '[]'::jsonb),
    'switches', (select jsonb_object_agg(key, value) from public.triage_config where key ~ '^auto_[a-z]+$'),
    'feedback', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'lang', lang, 'page', page, 'message', message) order by at)
      from public.feedback, since where at > since.t), '[]'::jsonb),
    'feedback_open', (select count(*) from public.feedback where status = 'new'))
$$;

/** Stores a summary. */
create function public.save_triage_digest(p_source text, p_summary text, p_stats jsonb)
returns bigint language sql security definer set search_path = '' as $$
  insert into public.triage_digest (source, summary, stats) values (p_source, left(p_summary, 20000), coalesce(p_stats, '{}')) returning id
$$;

/** The newest summary, for the review page. */
create function public.mod_latest_digest()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_moderator();
  return (select jsonb_build_object('id', id, 'at', at, 'source', source, 'summary', summary, 'stats', stats) from public.triage_digest order by at desc limit 1);
end $$;

/** Summaries are kept for a year. */
create function public.purge_old_digests()
returns int language sql security definer set search_path = '' as $$
  with gone as (delete from public.triage_digest where at < now() - interval '12 months' returning 1) select count(*)::int from gone
$$;

-- A game's page: as before, plus when each player's chat is paused until (both browsers honour it).
create or replace function public.game_info(p_game uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', g.id,
    'me', public.my_color(g.id),
    'red', jsonb_build_object('username', pr.username, 'avatar', case when not public.is_under16(pr) then pr.avatar end, 'rating', round(rr.rating), 'rd', round(rr.rd),
      'chat_muted_until', public.chat_muted_until(g.red)),
    'black', jsonb_build_object('username', pb.username, 'avatar', case when not public.is_under16(pb) then pb.avatar end, 'rating', round(rb.rating), 'rd', round(rb.rd),
      'chat_muted_until', public.chat_muted_until(g.black)),
    'base', g.base, 'inc', g.inc, 'speed', g.speed, 'rated', g.rated, 'relay', g.relay,
    'status', g.status, 'result', g.result, 'reason', g.reason, 'moves', to_jsonb(g.moves),
    'red_rating_before', g.red_rating_before, 'red_rating_after', g.red_rating_after,
    'black_rating_before', g.black_rating_before, 'black_rating_after', g.black_rating_after,
    'started_at', g.started_at, 'ended_at', g.ended_at
  )
  from public.games g
  left join public.profiles pr on pr.user_id = g.red
  left join public.profiles pb on pb.user_id = g.black
  left join public.ratings rr on rr.user_id = g.red and rr.kind = g.speed
  left join public.ratings rb on rb.user_id = g.black and rb.kind = g.speed
  where g.id = p_game and (auth.uid() in (g.red, g.black) or public.game_public(g))
$$;

revoke all on function public.chat_muted_until(uuid), public.triage_auto_act(bigint, text), public.save_triage_advice(bigint, text, text, numeric, text, text),
  public.mod_auto_actions(boolean, int), public.mod_triage_switches(), public.mod_set_auto(text, boolean, text), public.mod_review_auto(bigint, boolean, text),
  public.triage_digest_input(), public.save_triage_digest(text, text, jsonb), public.mod_latest_digest(), public.purge_old_digests()
  from public, anon, authenticated;
grant execute on function public.mod_auto_actions(boolean, int), public.mod_triage_switches(), public.mod_set_auto(text, boolean, text),
  public.mod_review_auto(bigint, boolean, text), public.mod_latest_digest() to authenticated;
grant execute on function public.save_triage_advice(bigint, text, text, numeric, text, text), public.triage_digest_input(), public.save_triage_digest(text, text, jsonb)
  to service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('purge-old-digests', '39 3 * * *', 'select public.purge_old_digests()');
  end if;
end $$;
