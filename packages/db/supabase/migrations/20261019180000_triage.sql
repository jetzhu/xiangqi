-- Report triage, phase 1 (docs/v0.3-online-design.md, "Moderation"): rules give every report a
-- first verdict (likely valid, likely invalid, inconclusive) with a confidence, in shadow mode:
-- shown on the review page, taking no action. Each moderator decision is compared with the
-- verdicts, so the page can show how often each rule agreed, and automatic actions can be
-- switched on per category once they've earned it (phase 2). Advisers (an AI, phase 3) add
-- their own verdicts through the same table, under their own name.

-- Settings: when each category may act on its own (all off: shadow mode), and the rules' numbers.
create table public.triage_config (
  key text primary key,
  value numeric not null
);
alter table public.triage_config enable row level security;
revoke all on public.triage_config from anon, authenticated;
insert into public.triage_config (key, value) values
  -- Phase 2 switches: 1 lets that category's confident verdicts act. All off for now.
  ('auto_stalling', 0), ('auto_chat', 0), ('auto_engine', 0), ('auto_username', 0),
  -- Chat: this many phrases from the suspect, or the same phrase this many times in a row, is spam.
  ('chat_spam_count', 5), ('chat_repeat', 3),
  -- Engine: a normal standing over at least this many checked games makes a report likely invalid.
  ('engine_min_checked', 10);

create function public.triage_value(p_key text)
returns numeric language sql stable security definer set search_path = '' as $$
  select value from public.triage_config where key = p_key
$$;

-- Words that make a username offensive, matched inside the name ignoring case. Private, filled
-- by the site owner (not in the repository); empty, username reports go to an adviser or a person.
create table public.username_blocklist (
  word text primary key check (word = lower(word) and length(word) >= 3)
);
alter table public.username_blocklist enable row level security;
revoke all on public.username_blocklist from anon, authenticated;

-- Verdicts on reports: one per report per source ('rules', or an adviser such as 'ai:claude-code').
create table public.report_triage (
  report_id bigint not null references public.reports (id) on delete cascade,
  source text not null,
  verdict text not null check (verdict in ('valid', 'invalid', 'inconclusive')),
  confidence numeric not null check (confidence between 0 and 1),
  -- Which rule (or adviser model) decided, and why, in a line a moderator can read.
  rule text not null,
  reason text not null,
  at timestamptz not null default now(),
  primary key (report_id, source)
);
alter table public.report_triage enable row level security;
revoke all on public.report_triage from anon, authenticated;

-- Each verdict against the moderator's decision on the same report.
create table public.triage_outcomes (
  report_id bigint not null references public.reports (id) on delete cascade,
  source text not null,
  category text not null,
  predicted text not null,
  decided text not null,
  confidence numeric not null,
  at timestamptz not null default now(),
  primary key (report_id, source)
);
alter table public.triage_outcomes enable row level security;
revoke all on public.triage_outcomes from anon, authenticated;

/** The chat phrases the suspect sent in a game, from whichever browser recorded more of them. */
create function public.suspect_chat(g public.games, p_suspect uuid)
returns jsonb language sql stable set search_path = '' as $$
  with side as (select case when g.red = p_suspect then 'red' else 'black' end as c),
  recs as (
    select coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(g.red_end->'chat', '[]')) e, side where e->>'by' = side.c), '[]'::jsonb) as a,
           coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(g.black_end->'chat', '[]')) e, side where e->>'by' = side.c), '[]'::jsonb) as b
  )
  select case when jsonb_array_length(a) >= jsonb_array_length(b) then a else b end from recs
$$;

/**
 * The rules' verdict on one report, from the evidence on the server:
 * - stalling: the game's sportsmanship marks (stalled or left) for the suspect;
 * - chat: how many phrases the suspect sent, and the longest run of one phrase, from both
 *   browsers' records;
 * - engine: the suspect's fair-play standing at the game's speed;
 * - username: the private word list;
 * - other: always left to an adviser or a person.
 */
create function public.triage_rules(p_report bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.reports;
  g public.games;
  labels jsonb;
  chat jsonb;
  sent int;
  run int := 0;
  best int := 0;
  prev text;
  e jsonb;
  f public.fairplay;
  checked int;
  name text;
  out jsonb;
begin
  select * into r from public.reports where id = p_report;
  if not found then return null; end if;
  select * into g from public.games where id = r.game_id;
  case r.reason
    when 'stalling' then
      labels := public.labels_of(g, r.suspect);
      out := case when labels ?| array['stalled', 'abandoned']
        then jsonb_build_object('verdict', 'valid', 'confidence', 0.95, 'rule', 'stall-mark',
               'reason', 'The game is marked ' || (select string_agg(x, ' and ') from jsonb_array_elements_text(labels) x where x in ('stalled', 'abandoned')) || ' for this player.')
        else jsonb_build_object('verdict', 'invalid', 'confidence', 0.8, 'rule', 'no-stall-mark',
               'reason', 'No stalling or leaving in this game by the server''s clock.') end;
    when 'chat' then
      if g.red_end is null and g.black_end is null then
        return jsonb_build_object('verdict', 'inconclusive', 'confidence', 0.5, 'rule', 'no-chat-record', 'reason', 'Neither browser''s record of the chat reached the server.');
      end if;
      chat := public.suspect_chat(g, r.suspect);
      sent := jsonb_array_length(chat);
      for e in select * from jsonb_array_elements(chat) loop
        run := case when e->>'phrase' = prev then run + 1 else 1 end;
        best := greatest(best, run);
        prev := e->>'phrase';
      end loop;
      out := case
        when sent >= public.triage_value('chat_spam_count') or best >= public.triage_value('chat_repeat')
          then jsonb_build_object('verdict', 'valid', 'confidence', 0.85, 'rule', 'chat-spam',
                 'reason', format('Sent %s phrases, up to %s of the same in a row.', sent, best))
        when sent <= 1
          then jsonb_build_object('verdict', 'invalid', 'confidence', 0.85, 'rule', 'chat-little',
                 'reason', format('Sent %s phrase%s in the game.', sent, case when sent = 1 then '' else 's' end))
        else jsonb_build_object('verdict', 'inconclusive', 'confidence', 0.5, 'rule', 'chat-borderline',
               'reason', format('Sent %s phrases: needs a look at what and when.', sent)) end;
    when 'engine' then
      select * into f from public.fairplay where user_id = r.suspect and speed = g.speed;
      checked := coalesce(f.games, 0);
      out := case
        when f.verdict = 'likely' then jsonb_build_object('verdict', 'valid', 'confidence', 0.9, 'rule', 'standing-likely',
               'reason', format('Fair-play standing at this speed is "likely" (score %s over %s games).', f.score, f.games))
        when f.verdict = 'watch' then jsonb_build_object('verdict', 'inconclusive', 'confidence', 0.6, 'rule', 'standing-watch',
               'reason', format('Standing is "watch" (score %s over %s games): more games needed.', f.score, f.games))
        when checked >= public.triage_value('engine_min_checked') then jsonb_build_object('verdict', 'invalid', 'confidence', 0.8, 'rule', 'standing-normal',
               'reason', format('Normal standing over %s checked games at this speed.', checked))
        else jsonb_build_object('verdict', 'inconclusive', 'confidence', 0.4, 'rule', 'few-checked',
               'reason', format('Only %s checked games at this speed: waiting for more.', checked)) end;
    when 'username' then
      select username into name from public.profiles where user_id = r.suspect;
      out := case when exists (select 1 from public.username_blocklist b where position(b.word in lower(name)) > 0)
        then jsonb_build_object('verdict', 'valid', 'confidence', 0.9, 'rule', 'username-word', 'reason', 'The username contains a word on the blocklist.')
        else jsonb_build_object('verdict', 'inconclusive', 'confidence', 0.3, 'rule', 'username-judgement', 'reason', 'No blocklisted word: needs judgement.') end;
    else
      out := jsonb_build_object('verdict', 'inconclusive', 'confidence', 0.2, 'rule', 'free-text', 'reason', 'Reason "other": needs someone to read the note.');
  end case;
  return out;
end $$;

/** Runs the rules on a report and stores the verdict (source 'rules'). */
create function public.triage_report(p_report bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := public.triage_rules(p_report);
begin
  if v is null then return; end if;
  insert into public.report_triage (report_id, source, verdict, confidence, rule, reason)
  values (p_report, 'rules', v->>'verdict', (v->>'confidence')::numeric, v->>'rule', v->>'reason')
  on conflict (report_id, source) do update set verdict = excluded.verdict, confidence = excluded.confidence,
    rule = excluded.rule, reason = excluded.reason, at = now();
end $$;

create function public.reports_triage()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.triage_report(new.id);
  return new;
end $$;
create trigger reports_triage after insert on public.reports for each row execute function public.reports_triage();

/** Evidence changes (games get checked, chat records arrive): open reports are looked at again hourly. */
create function public.retriage_open_reports()
returns int language plpgsql security definer set search_path = '' as $$
declare
  n int := 0;
  r record;
begin
  for r in select id from public.reports where status = 'open' and created_at > now() - interval '60 days' loop
    perform public.triage_report(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('retriage-open-reports', '41 * * * *', 'select public.retriage_open_reports()');
  end if;
end $$;

-- Each decision is compared with every verdict on that player's reports: no violation against
-- "invalid", violation against "valid", not conclusive against "inconclusive".
create function public.mod_log_triage_outcomes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  decided text := case new.action when 'dismiss' then 'invalid' when 'confirm' then 'valid' when 'inconclusive' then 'inconclusive' end;
begin
  if decided is null or new.target is null then return new; end if;
  insert into public.triage_outcomes (report_id, source, category, predicted, decided, confidence)
  select t.report_id, t.source, r.reason, t.verdict, decided, t.confidence
  from public.report_triage t join public.reports r on r.id = t.report_id
  where r.suspect = new.target and (r.status = 'open' or r.decided_at = new.at)
  on conflict (report_id, source) do update set predicted = excluded.predicted, decided = excluded.decided,
    confidence = excluded.confidence, at = now();
  return new;
end $$;
create trigger mod_log_triage_outcomes after insert on public.mod_log for each row execute function public.mod_log_triage_outcomes();

/**
 * How often each source's verdicts matched the moderators', per report reason, over the last
 * 90 days: decisions, agreements, and the agreement on confident verdicts (0.8 or more), which
 * is what phase 2 would act on.
 */
create function public.triage_agreement()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_moderator();
  return coalesce((
    select jsonb_agg(jsonb_build_object('source', source, 'category', category, 'decisions', n, 'agreed', agreed,
      'confident', confident, 'confident_agreed', confident_agreed) order by source, category)
    from (
      select source, category, count(*) as n, count(*) filter (where predicted = decided) as agreed,
        count(*) filter (where confidence >= 0.8) as confident,
        count(*) filter (where confidence >= 0.8 and predicted = decided) as confident_agreed
      from public.triage_outcomes where at > now() - interval '90 days'
      group by source, category
    ) x), '[]'::jsonb);
end $$;

-- The queue and the case, extended with the verdicts --------------------------------------------

alter function public.mod_queue() rename to mod_queue_base;
revoke all on function public.mod_queue_base() from public, anon, authenticated;

/** The queue, each case with how its open reports were triaged ({valid, invalid, inconclusive}). */
create function public.mod_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return coalesce((
    select jsonb_agg(c || jsonb_build_object('triage', (
      select jsonb_build_object(
        'valid', count(*) filter (where t.verdict = 'valid'),
        'invalid', count(*) filter (where t.verdict = 'invalid'),
        'inconclusive', count(*) filter (where t.verdict = 'inconclusive'))
      from public.reports r join public.profiles p on p.user_id = r.suspect
      join public.report_triage t on t.report_id = r.id and t.source = 'rules'
      where lower(p.username) = lower(c->>'username') and r.status = 'open')))
    from jsonb_array_elements(public.mod_queue_base()) c), '[]'::jsonb);
end $$;

alter function public.mod_case(text) rename to mod_case_reviews;
revoke all on function public.mod_case_reviews(text) from public, anon, authenticated;

/** The case, each report with every verdict on it (the rules, and any adviser). */
create function public.mod_case(p_username text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  base jsonb := public.mod_case_reviews(p_username);
begin
  if base is null then return null; end if;
  return base || jsonb_build_object('reports', coalesce((
    select jsonb_agg(rp || jsonb_build_object('triage', coalesce((
      select jsonb_agg(jsonb_build_object('source', t.source, 'verdict', t.verdict, 'confidence', t.confidence, 'rule', t.rule, 'reason', t.reason, 'at', t.at)
        order by t.source = 'rules' desc, t.source)
      from public.report_triage t where t.report_id = (rp->>'id')::bigint), '[]'::jsonb)))
    from jsonb_array_elements(base->'reports') rp), '[]'::jsonb));
end $$;

-- Advisers (phase 3, packages/triage) -------------------------------------------------------------

/**
 * Open reports that an adviser hasn't looked at since they last changed, with what it needs to
 * judge them: the reason and note, the rules' verdict, the suspect's chat in that game and
 * standing at its speed, and the username. No email addresses, nothing beyond the case.
 */
create function public.triage_pending(p_source text, p_limit int default 20)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object(
      'report', r.id, 'reason', r.reason, 'note', r.note, 'reported_at', r.created_at,
      'suspect', sp.username,
      'game', jsonb_build_object('speed', g.speed, 'base', g.base, 'inc', g.inc, 'result', g.result, 'reason', g.reason,
        'plies', coalesce(array_length(g.moves, 1), 0), 'suspect_color', case when g.red = r.suspect then 'red' else 'black' end,
        'labels', public.labels_of(g, r.suspect),
        'chat', jsonb_build_object('red', g.red_end->'chat', 'black', g.black_end->'chat')),
      'standing', (select jsonb_build_object('games', f.games, 'score', f.score, 'verdict', f.verdict) from public.fairplay f where f.user_id = r.suspect and f.speed = g.speed),
      'rules', (select jsonb_build_object('verdict', t.verdict, 'confidence', t.confidence, 'rule', t.rule, 'reason', t.reason)
                from public.report_triage t where t.report_id = r.id and t.source = 'rules')) as x
    from public.reports r join public.games g on g.id = r.game_id join public.profiles sp on sp.user_id = r.suspect
    where r.status = 'open'
      and not exists (select 1 from public.report_triage a where a.report_id = r.id and a.source = p_source
                      and a.at >= coalesce((select t.at from public.report_triage t where t.report_id = r.id and t.source = 'rules'), r.created_at))
    order by r.created_at limit least(p_limit, 100)
  ) y
$$;

/** Stores an adviser's verdict on a report. */
create function public.save_triage_advice(p_report bigint, p_source text, p_verdict text, p_confidence numeric, p_rule text, p_reason text)
returns void language sql security definer set search_path = '' as $$
  insert into public.report_triage (report_id, source, verdict, confidence, rule, reason)
  values (p_report, p_source, p_verdict, least(1, greatest(0, p_confidence)), left(p_rule, 80), left(p_reason, 500))
  on conflict (report_id, source) do update set verdict = excluded.verdict, confidence = excluded.confidence,
    rule = excluded.rule, reason = excluded.reason, at = now()
$$;

-- Access ----------------------------------------------------------------------------------

revoke all on function public.triage_value(text), public.suspect_chat(public.games, uuid), public.triage_rules(bigint), public.triage_report(bigint),
  public.reports_triage(), public.retriage_open_reports(), public.mod_log_triage_outcomes(), public.triage_agreement(), public.mod_queue(),
  public.mod_case(text), public.triage_pending(text, int), public.save_triage_advice(bigint, text, text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.triage_agreement(), public.mod_queue(), public.mod_case(text) to authenticated;
grant execute on function public.triage_pending(text, int), public.save_triage_advice(bigint, text, text, numeric, text, text), public.retriage_open_reports() to service_role;
