-- M23 (2026-10-21, docs/v0.4-design.md "Coaching"): email from the site through an outbox, and
-- coach links. The player starts a link (by the coach's username or a one-time code); a guardian
-- confirms by email for a player under 16, unless the guardian has lowered that line to 13 for
-- this child; the coach accepts. Either side can end it. A coach sees the student's finished
-- online games, their reviews and ratings, nothing else, and an opponent under 16 who isn't also
-- their student only as "an opponent under 16". Every game a coach opens is logged for the
-- student. Up to 15 students under 16 per coach (more wait for a moderator), 3 family links per
-- parent. No messaging.

-- The mail outbox --------------------------------------------------------------------------------

-- Email beyond sign-in: rows wait here; the `mailer` function sends them over SMTP with fixed
-- bilingual templates (users never write the text). Sent rows lose their data at once (links
-- with tokens) and go after 30 days.
create table public.mail_outbox (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  to_email text not null check (to_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(to_email) <= 200),
  template text not null,
  lang text not null default 'en' check (lang in ('en', 'zh')),
  data jsonb not null default '{}',
  -- Who it's about or on whose behalf, for limits; null for the site's own mail.
  user_id uuid references auth.users (id) on delete set null,
  send_after timestamptz not null default now(),
  claimed_at timestamptz,
  attempts int not null default 0,
  sent_at timestamptz,
  last_error text
);
create index mail_outbox_due on public.mail_outbox (send_after) where sent_at is null;
alter table public.mail_outbox enable row level security;
revoke all on public.mail_outbox from anon, authenticated;

-- How the database reaches the mailer: its address and a shared key (the function has the same
-- key as a secret). Filled when the mailer is deployed (scripts/mail-setup.mjs), never in the repository.
create table public.mailer_config (key text primary key, value text not null);
alter table public.mailer_config enable row level security;
revoke all on public.mailer_config from anon, authenticated;

/** Queues an email. */
create function public.queue_mail(p_to text, p_template text, p_lang text, p_data jsonb, p_user uuid, p_after timestamptz default now())
returns bigint language sql security definer set search_path = '' as $$
  insert into public.mail_outbox (to_email, template, lang, data, user_id, send_after)
  values (lower(trim(p_to)), p_template, case when p_lang = 'zh' then 'zh' else 'en' end, coalesce(p_data, '{}'), p_user, coalesce(p_after, now()))
  returning id
$$;

/**
 * The mailer takes up to `p_limit` due emails (fewer if 100 went in the last hour, the site's
 * own limit under Gmail's), each tried at most 5 times; a claim lapses after 5 minutes.
 */
create function public.mail_claim(p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  room int := 100 - (select count(*) from public.mail_outbox where sent_at > now() - interval '1 hour');
  out jsonb;
begin
  with m as (
      update public.mail_outbox o set claimed_at = now(), attempts = o.attempts + 1
      where o.id in (
        select id from public.mail_outbox
        where sent_at is null and send_after <= now() and attempts < 5 and (claimed_at is null or claimed_at < now() - interval '5 minutes')
        order by send_after limit greatest(0, least(p_limit, room))
        for update skip locked)
      returning o.id, o.to_email, o.template, o.lang, o.data)
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'to', m.to_email, 'template', m.template, 'lang', m.lang, 'data', m.data)), '[]'::jsonb) into out from m;
  return out;
end $$;

/** The mailer reports each email: sent (its data is cleared), or the error (tried again later). */
create function public.mail_done(p_id bigint, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update public.mail_outbox set
    sent_at = case when p_error is null then now() end,
    data = case when p_error is null then '{}'::jsonb else data end,
    claimed_at = null,
    last_error = left(p_error, 500),
    send_after = case when p_error is null then send_after else now() + interval '10 minutes' end
  where id = p_id
$$;

/** Asks the mailer to run when mail is due (every minute, from pg_cron, through pg_net). */
create function public.poke_mailer()
returns void language plpgsql security definer set search_path = '' as $$
declare
  url text := (select value from public.mailer_config where key = 'url');
  k text := (select value from public.mailer_config where key = 'key');
begin
  if url is null or k is null then return; end if;
  if not exists (select 1 from public.mail_outbox where sent_at is null and send_after <= now() and attempts < 5) then return; end if;
  perform net.http_post(url := url, headers := jsonb_build_object('content-type', 'application/json', 'x-mailer-key', k), body := '{}'::jsonb);
end $$;

/** Sent mail goes after 30 days, failed mail after 90. Daily. */
create function public.purge_old_mail()
returns int language sql security definer set search_path = '' as $$
  with gone as (delete from public.mail_outbox where sent_at < now() - interval '30 days' or created_at < now() - interval '90 days' returning 1)
  select count(*)::int from gone
$$;

-- Coach links -------------------------------------------------------------------------------------

alter table public.profiles add column coach_barred boolean not null default false;

/** 18 or over by birth month (the birthday counts as the last day of that month). */
create function public.is_adult(p public.profiles)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(public.birth_month_now(p) + interval '18 years 1 month' <= now(), false)
$$;

/** Why a player can't coach yet ('age', 'email', 'new', 'barred'), or null when they can. */
create function public.coach_problem(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not public.is_adult(p) then 'age'
    when u.email_confirmed_at is null then 'email'
    when p.created_at > now() - interval '7 days' then 'new'
    when p.coach_barred then 'barred'
  end
  from public.profiles p join auth.users u on u.id = p.user_id where p.user_id = p_user
$$;

create table public.coach_links (
  id bigint generated always as identity primary key,
  coach uuid not null references auth.users (id) on delete cascade,
  student uuid not null references auth.users (id) on delete cascade,
  -- 'family': the coach is the student's parent or guardian (counts toward the parent's 3).
  kind text not null check (kind in ('coach', 'family')),
  -- guardian: waiting for the guardian's email confirmation; coach: for the coach to accept;
  -- review: over the coach's cap, waiting for a moderator; then active, or ended / declined.
  status text not null check (status in ('guardian', 'coach', 'review', 'active', 'ended', 'declined')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  accepted_at timestamptz,
  ended_at timestamptz,
  ended_by text check (ended_by in ('student', 'coach', 'guardian', 'moderator', 'expired')),
  -- The guardian's email only until they answer (then cleared); its hash stays, to know them again.
  guardian_email text,
  guardian_hash text,
  -- The guardian's link: its hash only. Valid 14 days to answer, then 90 days to manage.
  token_hash text unique,
  token_expires timestamptz,
  under16 boolean not null
);
create unique index coach_links_one_open on public.coach_links (coach, student) where status in ('guardian', 'coach', 'review', 'active');
create index coach_links_student on public.coach_links (student, status);
create index coach_links_coach on public.coach_links (coach, status);
alter table public.coach_links enable row level security;
revoke all on public.coach_links from anon, authenticated;

-- A guardian may lower the confirmation line to 13 for their child: then the child (13–15) links
-- coaches without a confirmation each time. Logged in mod_log and changeable back by the guardian.
create table public.guardian_settings (
  student uuid primary key references auth.users (id) on delete cascade,
  line_lowered boolean not null,
  guardian_hash text,
  set_at timestamptz not null default now()
);
alter table public.guardian_settings enable row level security;
revoke all on public.guardian_settings from anon, authenticated;

create table public.coach_codes (
  code text primary key,
  coach uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table public.coach_codes enable row level security;
revoke all on public.coach_codes from anon, authenticated;

-- Every game a coach opened, for the student (and their guardian, and moderators) to see.
create table public.coach_visits (
  id bigint generated always as identity primary key,
  coach uuid not null references auth.users (id) on delete cascade,
  student uuid not null references auth.users (id) on delete cascade,
  game_id uuid references public.games (id) on delete set null,
  at timestamptz not null default now()
);
create index coach_visits_student on public.coach_visits (student, at desc);
alter table public.coach_visits enable row level security;
revoke all on public.coach_visits from anon, authenticated;

create table public.coach_reports (
  id bigint generated always as identity primary key,
  link_id bigint references public.coach_links (id) on delete set null,
  coach uuid not null references auth.users (id) on delete cascade,
  reporter uuid references auth.users (id) on delete set null,
  note text not null check (length(note) between 1 and 500),
  at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'closed'))
);
alter table public.coach_reports enable row level security;
revoke all on public.coach_reports from anon, authenticated;

-- Caps, kept in triage_config with the other private numbers.
insert into public.triage_config (key, value) values ('coach_under16_cap', 15), ('family_cap', 3), ('coach_requests_open', 5), ('guardian_mails_day', 3);

/** A random token for a guardian's link (about 240 bits), and how it's stored. */
create function public.new_token()
returns text language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;
create function public.token_hash(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
$$;

/** Whether a student needs a guardian's confirmation for a new link. */
create function public.needs_guardian(p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_under16(p) and not coalesce((select g.line_lowered from public.guardian_settings g where g.student = p.user_id), false)
  from public.profiles p where p.user_id = p_student
$$;

/**
 * The signed-in player asks a coach to link: by username (`p_coach`) or by a code from the coach
 * (`p_code`). `p_family`: the coach is their parent or guardian. A player who needs a guardian's
 * confirmation gives the guardian's email; the guardian gets a fixed email (at most 3 a day).
 */
create function public.request_coach(p_coach text, p_code text default null, p_family boolean default false, p_guardian_email text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  sp public.profiles;
  c uuid;
  cp public.profiles;
  why text;
  needs boolean;
  email text := lower(trim(coalesce(p_guardian_email, '')));
  tok text;
  link bigint;
  st text;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into sp from public.profiles where user_id = me;
  if public.birth_month_now(sp) is null then raise exception 'birth month first' using errcode = 'P0001', hint = 'birth-month'; end if;
  if nullif(trim(coalesce(p_code, '')), '') is not null then
    select k.coach into c from public.coach_codes k where k.code = upper(trim(p_code)) and k.expires_at > now() and k.used_at is null for update;
    if c is null then raise exception 'no such code' using errcode = 'P0002', hint = 'code'; end if;
    update public.coach_codes set used_at = now() where code = upper(trim(p_code));
  else
    select user_id into c from public.profiles where lower(username) = lower(trim(coalesce(p_coach, '')));
    if c is null then raise exception 'no such player' using errcode = 'P0002', hint = 'coach'; end if;
  end if;
  if c = me then raise exception 'not yourself' using errcode = 'P0001', hint = 'self'; end if;
  why := public.coach_problem(c);
  if why is not null then raise exception 'this player can''t coach yet' using errcode = 'P0001', hint = 'coach-' || why; end if;
  if exists (select 1 from public.coach_links where coach = c and student = me and status in ('guardian', 'coach', 'review', 'active')) then
    raise exception 'already linked or asked' using errcode = 'P0001', hint = 'exists';
  end if;
  if (select count(*) from public.coach_links where student = me and status in ('guardian', 'coach', 'review')) >= public.triage_value('coach_requests_open') then
    raise exception 'too many requests waiting' using errcode = 'P0001', hint = 'requests';
  end if;
  if p_family and (select count(*) from public.coach_links where coach = c and kind = 'family' and status in ('guardian', 'coach', 'review', 'active')) >= public.triage_value('family_cap') then
    raise exception 'that parent has 3 children linked' using errcode = 'P0001', hint = 'family-cap';
  end if;
  needs := public.needs_guardian(me);
  if needs then
    if email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'a guardian''s email is needed' using errcode = 'P0001', hint = 'guardian-email'; end if;
    if email = lower((select u.email from auth.users u where u.id = me)) then
      raise exception 'that''s your own email' using errcode = 'P0001', hint = 'guardian-self';
    end if;
    if (select count(*) from public.mail_outbox where user_id = me and template = 'guardian-confirm' and created_at > now() - interval '1 day') >= public.triage_value('guardian_mails_day') then
      raise exception 'guardian emails: 3 a day' using errcode = 'P0001', hint = 'mail-limit';
    end if;
    tok := public.new_token();
  end if;
  select * into cp from public.profiles where user_id = c;
  st := case when needs then 'guardian' else 'coach' end;
  insert into public.coach_links (coach, student, kind, status, guardian_email, guardian_hash, token_hash, token_expires, under16)
  values (c, me, case when p_family then 'family' else 'coach' end, st,
    case when needs then email end, case when needs then public.token_hash(email) end,
    case when needs then public.token_hash(tok) end, case when needs then now() + interval '14 days' end, public.is_under16(sp))
  returning id into link;
  if needs then
    perform public.queue_mail(email, 'guardian-confirm', sp.lang,
      jsonb_build_object('student', sp.username, 'coach', cp.username, 'family', p_family, 'token', tok), me);
  end if;
  return jsonb_build_object('id', link, 'status', st, 'coach', cp.username);
end $$;

/** A coach makes a one-time code (valid 24 hours) to give a student. */
create function public.create_coach_code()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  why text := public.coach_problem(me);
  new_code text;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if why is not null then raise exception 'you can''t coach yet' using errcode = 'P0001', hint = 'coach-' || why; end if;
  delete from public.coach_codes where coach = me and (used_at is not null or expires_at < now());
  if (select count(*) from public.coach_codes where coach = me) >= 10 then raise exception 'too many codes' using errcode = 'P0001', hint = 'codes'; end if;
  loop
    new_code := (select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '') from generate_series(1, 8));
    exit when not exists (select 1 from public.coach_codes k where k.code = new_code);
  end loop;
  insert into public.coach_codes (code, coach, expires_at) values (new_code, me, now() + interval '24 hours');
  return jsonb_build_object('code', new_code, 'expires_at', now() + interval '24 hours');
end $$;

/** A link by a guardian's token, if the token is still good. */
create function public.link_by_token(p_token text)
returns public.coach_links language sql stable security definer set search_path = '' as $$
  select * from public.coach_links where token_hash = public.token_hash(p_token) and token_expires > now()
$$;

/** What the guardian's page shows: the student, the coach, the request's state, and the line. */
create function public.guardian_view(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  l public.coach_links := public.link_by_token(p_token);
begin
  if l.id is null then return null; end if;
  return jsonb_build_object(
    'student', (select username from public.profiles where user_id = l.student),
    'coach', (select username from public.profiles where user_id = l.coach),
    'kind', l.kind, 'status', l.status, 'created_at', l.created_at,
    'line_lowered', coalesce((select line_lowered from public.guardian_settings where student = l.student), false),
    'visits', (select count(*) from public.coach_visits v where v.student = l.student and v.coach = l.coach));
end $$;

/**
 * The guardian answers: confirm (the request goes to the coach) or decline. `p_lower`, when not
 * null, sets whether the child may link coaches without asking each time (logged). The token
 * then stays good for 90 days, to change the line back or end the link.
 */
create function public.guardian_answer(p_token text, p_confirm boolean, p_lower boolean default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.coach_links := public.link_by_token(p_token);
begin
  if l.id is null then raise exception 'this link has expired' using errcode = 'P0002', hint = 'expired'; end if;
  if l.status = 'guardian' then
    update public.coach_links set status = case when p_confirm then 'coach' else 'declined' end,
      confirmed_at = case when p_confirm then now() end, ended_at = case when not p_confirm then now() end,
      ended_by = case when not p_confirm then 'guardian' end, guardian_email = null, token_expires = now() + interval '90 days'
    where id = l.id;
  end if;
  if p_lower is not null then
    insert into public.guardian_settings (student, line_lowered, guardian_hash) values (l.student, p_lower, l.guardian_hash)
    on conflict (student) do update set line_lowered = excluded.line_lowered, guardian_hash = excluded.guardian_hash, set_at = now();
    insert into public.mod_log (moderator, action, target, details)
    values (null, 'guardian-line', l.student, jsonb_build_object('lowered', p_lower, 'link', l.id));
  end if;
end $$;

/** The guardian ends the link from their page. */
create function public.guardian_end(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.coach_links := public.link_by_token(p_token);
begin
  if l.id is null then raise exception 'this link has expired' using errcode = 'P0002', hint = 'expired'; end if;
  update public.coach_links set status = 'ended', ended_at = now(), ended_by = 'guardian', guardian_email = null
  where id = l.id and status in ('guardian', 'coach', 'review', 'active');
end $$;

/** The coach accepts or declines a request. Past the cap of students under 16, it waits for a moderator. */
create function public.coach_answer(p_link bigint, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  l public.coach_links;
  st text;
begin
  select * into l from public.coach_links where id = p_link and coach = me and status = 'coach' for update;
  if not found then raise exception 'no such request' using errcode = 'P0002'; end if;
  if not p_accept then
    update public.coach_links set status = 'declined', ended_at = now(), ended_by = 'coach' where id = l.id;
    return 'declined';
  end if;
  if public.coach_problem(me) is not null then raise exception 'you can''t coach yet' using errcode = 'P0001', hint = 'coach-' || public.coach_problem(me); end if;
  st := case when l.kind = 'coach' and l.under16
      and (select count(*) from public.coach_links where coach = me and kind = 'coach' and under16 and status = 'active') >= public.triage_value('coach_under16_cap')
    then 'review' else 'active' end;
  update public.coach_links set status = st, accepted_at = now() where id = l.id;
  return st;
end $$;

/** Either side ends a link (or withdraws a request) at any time. */
create function public.end_coach_link(p_link bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  update public.coach_links set status = 'ended', ended_at = now(), ended_by = case when coach = me then 'coach' else 'student' end, guardian_email = null
  where id = p_link and me in (coach, student) and status in ('guardian', 'coach', 'review', 'active');
  if not found then raise exception 'no such link' using errcode = 'P0002'; end if;
end $$;

/** A student reports their coach (or a coach who asked them something odd), once a day per link. */
create function public.report_coach(p_link bigint, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  l public.coach_links;
begin
  select * into l from public.coach_links where id = p_link and student = me;
  if not found then raise exception 'no such link' using errcode = 'P0002'; end if;
  if exists (select 1 from public.coach_reports where link_id = l.id and reporter = me and at > now() - interval '1 day') then
    raise exception 'already reported today' using errcode = 'P0001', hint = 'once';
  end if;
  insert into public.coach_reports (link_id, coach, reporter, note) values (l.id, l.coach, me, left(trim(p_note), 500));
end $$;

/** Whether a coach has an active link to a player. */
create function public.coaches(p_coach uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.coach_links where coach = p_coach and student = p_student and status = 'active')
$$;

/**
 * Everything the coaching pages show the signed-in player. As a student: their links (coach,
 * kind, state), whether they need a guardian's confirmation, and the coaches' visits. As a
 * coach: whether they can coach, requests to answer, and students with their ratings and
 * finished online games in the last 30 days.
 */
create function public.my_coaching()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then return null; end if;
  return jsonb_build_object(
    'needs_guardian', public.needs_guardian(me),
    'coach_problem', public.coach_problem(me),
    'as_student', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'coach', p.username, 'kind', l.kind, 'status', l.status,
        'created_at', l.created_at, 'ended_at', l.ended_at, 'ended_by', l.ended_by) order by l.created_at desc)
      from public.coach_links l join public.profiles p on p.user_id = l.coach
      where l.student = me and (l.status in ('guardian', 'coach', 'review', 'active') or l.ended_at > now() - interval '90 days')), '[]'::jsonb),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('coach', p.username, 'game', v.game_id, 'at', v.at) order by v.at desc)
      from (select * from public.coach_visits where student = me order by at desc limit 50) v join public.profiles p on p.user_id = v.coach), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'student', p.username, 'kind', l.kind, 'status', l.status, 'under16', l.under16, 'created_at', l.created_at) order by l.created_at)
      from public.coach_links l join public.profiles p on p.user_id = l.student
      where l.coach = me and l.status in ('coach', 'review')), '[]'::jsonb),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'student', p.username, 'kind', l.kind, 'since', l.accepted_at,
        'ratings', coalesce((select jsonb_object_agg(r.kind, round(r.rating)) from public.ratings r where r.user_id = l.student and r.kind in ('lightning', 'blitz', 'rapid')), '{}'::jsonb),
        'games_30d', (select count(*) from public.games g where l.student in (g.red, g.black) and g.status = 'over' and g.ended_at > now() - interval '30 days'))
        order by p.username)
      from public.coach_links l join public.profiles p on p.user_id = l.student
      where l.coach = me and l.status = 'active'), '[]'::jsonb),
    'codes', coalesce((select jsonb_agg(jsonb_build_object('code', k.code, 'expires_at', k.expires_at)) from public.coach_codes k
      where k.coach = me and k.used_at is null and k.expires_at > now()), '[]'::jsonb));
end $$;

/**
 * A student's finished online games, for their coach, newest first: as games_of gives them, with
 * an opponent under 16 who isn't also the coach's student shown as null (the page says "an
 * opponent under 16").
 */
create function public.coach_student_games(p_student text, p_before timestamptz default null, p_limit int default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  s uuid := (select user_id from public.profiles where lower(username) = lower(p_student));
begin
  if s is null or not public.coaches(me, s) then raise exception 'not your student' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(g || jsonb_build_object('opponent', case
      when op.user_id is null then null
      when public.is_under16(op) and not public.coaches(me, op.user_id) then null
      else op.username end,
      'opponent_under16', op.user_id is not null and public.is_under16(op) and not public.coaches(me, op.user_id)) order by g->>'ended_at' desc)
    from jsonb_array_elements(public.games_of(s, p_before, p_limit, false)) g
    left join public.profiles op on lower(op.username) = lower(g->>'opponent')), '[]'::jsonb);
end $$;

/**
 * A coach opens one of their student's finished games: the game as game_info gives it, with an
 * opponent under 16 who isn't also their student hidden, and the visit logged.
 */
create function public.coach_game_info(p_game uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  g public.games;
  stu uuid;
  pr public.profiles;
  pb public.profiles;
  hidden jsonb := jsonb_build_object('username', null, 'avatar', null, 'rating', null, 'rd', null, 'under16', true);
begin
  select * into g from public.games where id = p_game and status = 'over';
  if not found then return null; end if;
  stu := case when public.coaches(me, g.red) then g.red when public.coaches(me, g.black) then g.black end;
  if stu is null then return null; end if;
  insert into public.coach_visits (coach, student, game_id) values (me, stu, g.id);
  select * into pr from public.profiles where user_id = g.red;
  select * into pb from public.profiles where user_id = g.black;
  return jsonb_build_object(
    'id', g.id, 'me', null, 'coach_of', case when stu = g.red then 'red' else 'black' end,
    'red', case when pr.user_id is not null and public.is_under16(pr) and not public.coaches(me, pr.user_id) then hidden
      else jsonb_build_object('username', pr.username, 'avatar', case when pr.user_id is not null and not public.is_under16(pr) then pr.avatar end,
        'rating', (select round(r.rating) from public.ratings r where r.user_id = g.red and r.kind = g.speed),
        'rd', (select round(r.rd) from public.ratings r where r.user_id = g.red and r.kind = g.speed)) end,
    'black', case when pb.user_id is not null and public.is_under16(pb) and not public.coaches(me, pb.user_id) then hidden
      else jsonb_build_object('username', pb.username, 'avatar', case when pb.user_id is not null and not public.is_under16(pb) then pb.avatar end,
        'rating', (select round(r.rating) from public.ratings r where r.user_id = g.black and r.kind = g.speed),
        'rd', (select round(r.rd) from public.ratings r where r.user_id = g.black and r.kind = g.speed)) end,
    'base', g.base, 'inc', g.inc, 'speed', g.speed, 'rated', g.rated, 'relay', g.relay,
    'status', g.status, 'result', g.result, 'reason', g.reason, 'moves', to_jsonb(g.moves),
    'red_rating_before', g.red_rating_before, 'red_rating_after', g.red_rating_after,
    'black_rating_before', g.black_rating_before, 'black_rating_after', g.black_rating_after,
    'started_at', g.started_at, 'ended_at', g.ended_at);
end $$;

-- Moderation --------------------------------------------------------------------------------------

/** Open coach reports and links waiting for a moderator (over a coach's cap). */
create function public.mod_coaching()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_moderator();
  return jsonb_build_object(
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'coach', cp.username, 'reporter', rp.username, 'note', r.note, 'at', r.at, 'link', r.link_id,
        'link_status', l.status, 'barred', cp.coach_barred) order by r.at)
      from public.coach_reports r join public.profiles cp on cp.user_id = r.coach left join public.profiles rp on rp.user_id = r.reporter
      left join public.coach_links l on l.id = r.link_id where r.status = 'open'), '[]'::jsonb),
    'review', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'coach', cp.username, 'student', sp.username, 'created_at', l.created_at,
        'students_under16', (select count(*) from public.coach_links x where x.coach = l.coach and x.kind = 'coach' and x.under16 and x.status = 'active')) order by l.accepted_at)
      from public.coach_links l join public.profiles cp on cp.user_id = l.coach join public.profiles sp on sp.user_id = l.student where l.status = 'review'), '[]'::jsonb));
end $$;

/** A coach's links, for a moderator. */
create function public.mod_coach_links(p_username text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c uuid := (select user_id from public.profiles where lower(username) = lower(p_username));
begin
  perform public.require_moderator();
  if c is null then return null; end if;
  return jsonb_build_object('coach', p_username, 'barred', (select coach_barred from public.profiles where user_id = c), 'problem', public.coach_problem(c),
    'links', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'student', sp.username, 'kind', l.kind, 'status', l.status, 'under16', l.under16,
        'created_at', l.created_at, 'ended_by', l.ended_by,
        'visits', (select count(*) from public.coach_visits v where v.coach = c and v.student = l.student)) order by l.created_at desc)
      from public.coach_links l join public.profiles sp on sp.user_id = l.student where l.coach = c), '[]'::jsonb));
end $$;

/** A moderator approves or declines a link over the cap, or ends any link (logged). */
create function public.mod_link(p_link bigint, p_action text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.coach_links;
begin
  perform public.require_moderator();
  select * into l from public.coach_links where id = p_link for update;
  if not found then raise exception 'no such link' using errcode = 'P0002'; end if;
  if p_action = 'approve' and l.status = 'review' then
    update public.coach_links set status = 'active' where id = l.id;
  elsif p_action = 'end' and l.status in ('guardian', 'coach', 'review', 'active') then
    update public.coach_links set status = 'ended', ended_at = now(), ended_by = 'moderator', guardian_email = null where id = l.id;
  else
    raise exception 'can''t % this link', p_action using errcode = 'P0001';
  end if;
  perform public.log_mod_action('coach-link-' || p_action, l.coach, jsonb_build_object('link', l.id, 'note', p_note));
end $$;

/** A moderator bars (ending every link) or unbars an account from coaching (logged). */
create function public.mod_bar_coach(p_username text, p_barred boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c uuid := (select user_id from public.profiles where lower(username) = lower(p_username));
begin
  perform public.require_moderator();
  if c is null then raise exception 'no such player' using errcode = 'P0002'; end if;
  update public.profiles set coach_barred = p_barred where user_id = c;
  if p_barred then
    update public.coach_links set status = 'ended', ended_at = now(), ended_by = 'moderator', guardian_email = null
    where coach = c and status in ('guardian', 'coach', 'review', 'active');
  end if;
  perform public.log_mod_action(case when p_barred then 'coach-bar' else 'coach-unbar' end, c, jsonb_build_object('note', p_note));
end $$;

/** A moderator closes a coach report (logged). */
create function public.mod_close_coach_report(p_id bigint, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c uuid;
begin
  perform public.require_moderator();
  update public.coach_reports set status = 'closed' where id = p_id and status = 'open' returning coach into c;
  if c is null then raise exception 'no such report' using errcode = 'P0002'; end if;
  perform public.log_mod_action('coach-report-close', c, jsonb_build_object('report', p_id, 'note', p_note));
end $$;

/** Guardians' links that were never answered lapse after 14 days. Daily, with the mail purge. */
create function public.expire_coach_requests()
returns int language sql security definer set search_path = '' as $$
  with gone as (
    update public.coach_links set status = 'ended', ended_at = now(), ended_by = 'expired', guardian_email = null
    where (status = 'guardian' and token_expires < now()) or (status = 'coach' and created_at < now() - interval '30 days')
    returning 1)
  select count(*)::int from gone
$$;

revoke all on function public.queue_mail(text, text, text, jsonb, uuid, timestamptz), public.mail_claim(int), public.mail_done(bigint, text), public.poke_mailer(),
  public.purge_old_mail(), public.is_adult(public.profiles), public.coach_problem(uuid), public.new_token(), public.token_hash(text), public.needs_guardian(uuid),
  public.request_coach(text, text, boolean, text), public.create_coach_code(), public.link_by_token(text), public.guardian_view(text),
  public.guardian_answer(text, boolean, boolean), public.guardian_end(text), public.coach_answer(bigint, boolean), public.end_coach_link(bigint),
  public.report_coach(bigint, text), public.coaches(uuid, uuid), public.my_coaching(), public.coach_student_games(text, timestamptz, int),
  public.coach_game_info(uuid), public.mod_coaching(), public.mod_coach_links(text), public.mod_link(bigint, text, text), public.mod_bar_coach(text, boolean, text),
  public.mod_close_coach_report(bigint, text), public.expire_coach_requests()
  from public, anon, authenticated;
grant execute on function public.request_coach(text, text, boolean, text), public.create_coach_code(), public.coach_answer(bigint, boolean),
  public.end_coach_link(bigint), public.report_coach(bigint, text), public.my_coaching(), public.coach_student_games(text, timestamptz, int),
  public.coach_game_info(uuid), public.mod_coaching(), public.mod_coach_links(text), public.mod_link(bigint, text, text),
  public.mod_bar_coach(text, boolean, text), public.mod_close_coach_report(bigint, text) to authenticated;
-- The guardian has no account here: their link is their key.
grant execute on function public.guardian_view(text), public.guardian_answer(text, boolean, boolean), public.guardian_end(text) to anon, authenticated;
grant execute on function public.mail_claim(int), public.mail_done(bigint, text) to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('poke-mailer', '* * * * *', 'select public.poke_mailer()');
    perform cron.schedule('purge-old-mail', '43 3 * * *', 'select public.purge_old_mail(); select public.expire_coach_requests()');
  end if;
end $$;
