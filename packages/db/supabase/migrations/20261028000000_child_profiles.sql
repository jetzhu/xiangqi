-- M24 (2026-10-22, docs/v0.4-design.md "Child profiles"): profiles for children under 13, made by
-- a parent from their own account, from the legal memo in docs/coaching-and-donations.md. Each
-- profile is its own sign-in identity (no email or password of its own: an address on .invalid
-- that never receives mail), so every existing page works for the child unchanged; only its
-- parent can open it, from the `child` server function. A child has no online play, no public
-- profile, no leaderboard, no coaching and no feedback reply. Consent is "email plus": the
-- parent reads the notice, confirms from an email, and gets a second email a day later. Not
-- offered for mainland China until a Chinese lawyer has advised (decision E7). Unconfirmed
-- profiles go after 14 days, unused ones after 24 months (warned a month before); consent
-- records stay 3 years after a profile ends.

-- The profile ------------------------------------------------------------------------------------

alter table public.profiles add column managed_by uuid references auth.users (id) on delete cascade;
create index profiles_managed_by on public.profiles (managed_by) where managed_by is not null;

/** Whether an account is a child profile. */
create function public.is_child(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where user_id = p_user and managed_by is not null)
$$;

-- What only the parent sees: the nickname, the birth year, and the profile's state.
create table public.child_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  parent uuid not null references auth.users (id) on delete cascade,
  nickname text not null check (length(nickname) between 1 and 20),
  birth_year int not null,
  country text not null check (country ~ '^[A-Z]{2}$'),
  status text not null default 'unconfirmed' check (status in ('unconfirmed', 'confirmed')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  -- Vietnam: a child aged 7 or over agrees too, the first time they open the profile.
  child_agreed_at timestamptz,
  retention_warned_at timestamptz
);
create index child_profiles_parent on public.child_profiles (parent);
alter table public.child_profiles enable row level security;
revoke all on public.child_profiles from anon, authenticated;

-- The record of consent, kept 3 years after the profile ends (so no foreign key to the child).
create table public.child_consents (
  id bigint generated always as identity primary key,
  parent uuid references auth.users (id) on delete set null,
  parent_email text not null,
  child_id uuid not null,
  birth_year int not null,
  country text not null,
  notice_version text not null,
  -- Korea: the parent's own words of consent (동의 or a statement), as typed.
  statement text check (length(statement) <= 300),
  created_at timestamptz not null default now(),
  token_hash text unique,
  confirmed_at timestamptz,
  ended_at timestamptz,
  ended_why text check (ended_why in ('deleted', 'withdrawn', 'unconfirmed', 'unused', 'own-account', 'parent-deleted'))
);
create index child_consents_child on public.child_consents (child_id);
alter table public.child_consents enable row level security;
revoke all on public.child_consents from anon, authenticated;

-- A request to turn a profile into the child's own account at 13: the email, until it confirms.
create table public.child_graduations (
  id bigint generated always as identity primary key,
  child_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  token_hash text unique not null,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
alter table public.child_graduations enable row level security;
revoke all on public.child_graduations from anon, authenticated;

insert into public.triage_config (key, value) values ('children_per_parent', 3);

-- The current notice; a parent agrees to this version.
create function public.child_notice_version()
returns text language sql immutable set search_path = '' as $$ select 'v1-2026-10-22' $$;

-- Mail never goes to a child profile's address.
create or replace function public.queue_mail(p_to text, p_template text, p_lang text, p_data jsonb, p_user uuid, p_after timestamptz default now())
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  id bigint;
begin
  if lower(trim(p_to)) like '%.invalid' then return null; end if;
  insert into public.mail_outbox (to_email, template, lang, data, user_id, send_after)
  values (lower(trim(p_to)), p_template, case when p_lang = 'zh' then 'zh' else 'en' end, coalesce(p_data, '{}'), p_user, coalesce(p_after, now()))
  returning mail_outbox.id into id;
  return id;
end $$;

-- What a child can't do --------------------------------------------------------------------------

-- No online play: every way into a game checks online_eligibility.
alter function public.online_eligibility() rename to online_eligibility_base;
create function public.online_eligibility()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.is_child(auth.uid())
    then public.online_eligibility_base() || jsonb_build_object('child', true, 'verified', false, 'casual_ok', false, 'eligible', false)
    else public.online_eligibility_base() end
$$;

-- No public profile.
alter function public.public_profile(text) rename to public_profile_base;
create function public.public_profile(p_username text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.profiles p where lower(p.username) = lower(p_username) and p.managed_by is not null)
    then null else public.public_profile_base(p_username) end
$$;

-- No feedback reply (there's no address of their own), and no coaching.
alter function public.send_feedback(text, text, text, text, text, boolean) rename to send_feedback_base;
create function public.send_feedback(p_kind text, p_message text, p_page text default null, p_version text default null, p_lang text default null, p_may_reply boolean default false)
returns void language sql security definer set search_path = '' as $$
  select public.send_feedback_base(p_kind, p_message, p_page, p_version, p_lang, p_may_reply and not public.is_child(auth.uid()))
$$;

create or replace function public.coach_problem(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p.managed_by is not null then 'child'
    when public.birth_month_now(p) is null then 'birth'
    when not public.is_adult(p) then 'age'
    when u.email_confirmed_at is null then 'email'
    when p.created_at > now() - interval '7 days' then 'new'
    when p.coach_barred then 'barred'
  end
  from public.profiles p join auth.users u on u.id = p.user_id where p.user_id = p_user
$$;

alter function public.request_coach(text, text, boolean, text) rename to request_coach_base;
create function public.request_coach(p_coach text, p_code text default null, p_family boolean default false, p_guardian_email text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if public.is_child(auth.uid()) then raise exception 'not on a child profile' using errcode = 'P0001', hint = 'child'; end if;
  return public.request_coach_base(p_coach, p_code, p_family, p_guardian_email);
end $$;
alter function public.request_coach_by_email(text, boolean, text) rename to request_coach_by_email_base;
create function public.request_coach_by_email(p_email text, p_family boolean default false, p_guardian_email text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if public.is_child(auth.uid()) then raise exception 'not on a child profile' using errcode = 'P0001', hint = 'child'; end if;
  return public.request_coach_by_email_base(p_email, p_family, p_guardian_email);
end $$;

-- A child's feedback never goes to the AI assistant's daily summary (docs/processors.md).
alter function public.triage_digest_input() rename to triage_digest_input_base;
create function public.triage_digest_input()
returns jsonb language sql stable security definer set search_path = '' as $$
  select b || jsonb_build_object('feedback', coalesce((
    select jsonb_agg(f) from jsonb_array_elements(b->'feedback') f
    where not exists (select 1 from public.feedback x where x.id = (f->>'id')::bigint and public.is_child(x.user_id))), '[]'::jsonb))
  from (select public.triage_digest_input_base() as b) t
$$;
revoke all on function public.triage_digest_input_base(), public.triage_digest_input() from public, anon, authenticated;
grant execute on function public.triage_digest_input() to service_role;

-- Creating a profile (with the `child` function) --------------------------------------------------

/**
 * The parent asks for a profile; the `child` function calls this with the parent's own session,
 * so every check is the parent's: "confirm it's you", 18 or over, an email of their own, at most
 * 3 children, not mainland China (the child's country or the parent's), the notice agreed, and
 * for Korea a typed statement. Returns what the function needs to create the identity.
 */
create function public.child_prepare(p_nickname text, p_birth_year int, p_country text, p_notice text, p_statement text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  p public.profiles;
  age int := extract(year from now())::int - p_birth_year;
  c text := upper(trim(coalesce(p_country, '')));
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into p from public.profiles where user_id = me;
  if p.managed_by is not null then raise exception 'not on a child profile' using errcode = 'P0001', hint = 'child'; end if;
  if not public.recently_authenticated(10) then raise exception 'confirm it''s you first' using errcode = '42501', hint = 'reauth'; end if;
  if not public.is_adult(p) then raise exception 'parents must be 18 or over' using errcode = 'P0001', hint = 'adult'; end if;
  if (select email_confirmed_at from auth.users where id = me) is null then raise exception 'confirm your email first' using errcode = 'P0001', hint = 'email'; end if;
  if c = 'CN' or p.country = 'CN' then raise exception 'not offered in mainland China yet' using errcode = 'P0001', hint = 'china'; end if;
  if c !~ '^[A-Z]{2}$' then raise exception 'choose a country' using errcode = '22023', hint = 'country'; end if;
  if p_notice is distinct from public.child_notice_version() then raise exception 'read the current notice' using errcode = 'P0001', hint = 'notice'; end if;
  if c = 'KR' and coalesce(trim(p_statement), '') = '' then raise exception 'type your consent' using errcode = 'P0001', hint = 'statement'; end if;
  if trim(coalesce(p_nickname, '')) = '' or length(trim(p_nickname)) > 20 then raise exception 'a nickname of up to 20 letters' using errcode = '22023', hint = 'nickname'; end if;
  -- Under 13 this year at the youngest; 2 at the youngest.
  if age < 2 or age > 13 then raise exception 'child profiles are for children under 13' using errcode = 'P0001', hint = 'age'; end if;
  if (select count(*) from public.child_profiles where parent = me) >= public.triage_value('children_per_parent') then
    raise exception 'at most 3 child profiles' using errcode = 'P0001', hint = 'limit';
  end if;
  return jsonb_build_object('ok', true, 'lang', p.lang);
end $$;

/**
 * Called by the `child` function (with the server key) once the identity exists: makes the
 * profile, records the consent, and emails the parent the confirmation link. The username is a
 * private placeholder; the nickname shows only to the parent and the child.
 */
create function public.child_register(p_parent uuid, p_child uuid, p_nickname text, p_birth_year int, p_country text, p_statement text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tok text := public.new_token();
  addr text := (select email from auth.users where id = p_parent);
  lang text := (select pr.lang from public.profiles pr where pr.user_id = p_parent);
  consent bigint;
begin
  perform set_config('xq.moderation', 'on', true);
  update public.profiles set managed_by = p_parent, birth_month = make_date(p_birth_year, 1, 1), country = upper(p_country),
    username_chosen = true
  where user_id = p_child;
  perform set_config('xq.moderation', '', true);
  insert into public.child_profiles (user_id, parent, nickname, birth_year, country) values (p_child, p_parent, trim(p_nickname), p_birth_year, upper(p_country));
  insert into public.child_consents (parent, parent_email, child_id, birth_year, country, notice_version, statement, token_hash)
  values (p_parent, addr, p_child, p_birth_year, upper(p_country), public.child_notice_version(), nullif(trim(coalesce(p_statement, '')), ''), public.token_hash(tok))
  returning id into consent;
  perform public.queue_mail(addr, 'child-consent', lang, jsonb_build_object('token', tok, 'nickname', trim(p_nickname), 'korean', upper(p_country) = 'KR'), p_parent);
  return jsonb_build_object('consent', consent);
end $$;

/** What the consent page shows for its link. */
create function public.child_consent_view(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nickname', cp.nickname, 'birth_year', c.birth_year, 'country', c.country, 'confirmed', c.confirmed_at is not null,
    'ended', c.ended_at is not null, 'expired', c.created_at < now() - interval '14 days')
  from public.child_consents c left join public.child_profiles cp on cp.user_id = c.child_id
  where c.token_hash = public.token_hash(p_token)
$$;

/**
 * The parent confirms from the email ("email plus", step one). The second email, a day later,
 * repeats the notice and how to withdraw.
 */
create function public.child_confirm(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.child_consents;
begin
  select * into c from public.child_consents where token_hash = public.token_hash(p_token) for update;
  if not found or c.ended_at is not null or c.created_at < now() - interval '14 days' then
    raise exception 'this link has expired' using errcode = 'P0002', hint = 'expired';
  end if;
  if c.confirmed_at is not null then return; end if;
  update public.child_consents set confirmed_at = now() where id = c.id;
  update public.child_profiles set status = 'confirmed', confirmed_at = now() where user_id = c.child_id;
  perform public.queue_mail(c.parent_email, 'child-consent-2', (select lang from public.profiles where user_id = c.parent),
    jsonb_build_object('nickname', (select nickname from public.child_profiles where user_id = c.child_id)), c.parent, now() + interval '24 hours');
end $$;

-- The parent's controls -----------------------------------------------------------------------------

/** The parent's children: nickname, age, state, when last used, and progress at a glance. */
create function public.my_children()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cp.user_id, 'nickname', cp.nickname, 'birth_year', cp.birth_year, 'country', cp.country, 'status', cp.status,
    'created_at', cp.created_at, 'last_used', u.last_sign_in_at,
    'can_graduate', extract(year from now())::int - cp.birth_year >= 13,
    'lessons', (select count(*) from public.lesson_progress l where l.user_id = cp.user_id and l.status = 'mastered'),
    'bot_games', (select count(*) from public.bot_games g where g.user_id = cp.user_id),
    'puzzle_rating', (select round(r.rating) from public.ratings r where r.user_id = cp.user_id and r.kind = 'puzzle'),
    'bot_rating', (select round(r.rating) from public.ratings r where r.user_id = cp.user_id and r.kind = 'bot'),
    'days_active_30', (select count(*) from public.player_state s, jsonb_array_elements_text(s.value) d
                       where s.user_id = cp.user_id and s.key = 'activity' and d::date > now()::date - 30)) order by cp.created_at), '[]'::jsonb)
  from public.child_profiles cp join auth.users u on u.id = cp.user_id
  where cp.parent = auth.uid()
$$;

/** Whether the caller is this child's parent. */
create function public.parent_of(p_child uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.child_profiles where user_id = p_child and parent = auth.uid())
$$;

/**
 * The `child` function asks this (with the parent's session) before opening a profile on the
 * parent's device: it must be theirs and confirmed. Returns the identity's sign-in address.
 */
create function public.child_switch_check(p_child uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.parent_of(p_child) then raise exception 'not your child' using errcode = '42501'; end if;
  if (select status from public.child_profiles where user_id = p_child) <> 'confirmed' then
    raise exception 'confirm the profile from your email first' using errcode = 'P0001', hint = 'unconfirmed';
  end if;
  return (select email from auth.users where id = p_child);
end $$;

/** Everything kept about a child, for their parent to download. */
create function public.child_export(p_child uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.parent_of(p_child) then raise exception 'not your child' using errcode = '42501'; end if;
  return jsonb_build_object(
    'profile', (select to_jsonb(cp) - 'parent' from public.child_profiles cp where cp.user_id = p_child),
    'consent', (select jsonb_agg(to_jsonb(c) - 'token_hash' - 'parent') from public.child_consents c where c.child_id = p_child),
    'lesson_progress', (select jsonb_agg(to_jsonb(x) - 'user_id') from public.lesson_progress x where x.user_id = p_child),
    'player_state', (select jsonb_agg(to_jsonb(x) - 'user_id') from public.player_state x where x.user_id = p_child),
    'settings', (select jsonb_agg(to_jsonb(x) - 'user_id') from public.settings x where x.user_id = p_child),
    'ratings', (select jsonb_agg(to_jsonb(x) - 'user_id') from public.ratings x where x.user_id = p_child),
    'bot_games', (select jsonb_agg(to_jsonb(x) - 'user_id') from public.bot_games x where x.user_id = p_child),
    'puzzle_attempts', (select jsonb_agg(to_jsonb(x) - 'user_id') from public.puzzle_attempts x where x.user_id = p_child),
    'analyses', (select jsonb_agg(to_jsonb(x) - 'user_id') from public.analyses x where x.user_id = p_child));
end $$;

/** Ends a profile: its identity and everything in it go at once; the consent record stays. */
create function public.child_end(p_child uuid, p_why text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.child_consents set ended_at = coalesce(ended_at, now()), ended_why = coalesce(ended_why, p_why), token_hash = null where child_id = p_child;
  delete from auth.users where id = p_child;
end $$;

/** The parent deletes a profile (or withdraws consent, which is the same), after "confirm it's you". */
create function public.delete_child(p_child uuid, p_withdraw boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.parent_of(p_child) then raise exception 'not your child' using errcode = '42501'; end if;
  if not public.recently_authenticated(10) then raise exception 'confirm it''s you first' using errcode = '42501', hint = 'reauth'; end if;
  perform public.child_end(p_child, case when p_withdraw then 'withdrawn' else 'deleted' end);
end $$;

-- A parent's own account going takes their children's profiles with it.
create function public.children_follow_parent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.child_consents set ended_at = coalesce(ended_at, now()), ended_why = coalesce(ended_why, 'parent-deleted'), token_hash = null
  where child_id in (select user_id from public.child_profiles where parent = old.id);
  delete from auth.users where id in (select user_id from public.child_profiles where parent = old.id);
  return old;
end $$;
create trigger children_follow_parent before delete on auth.users for each row execute function public.children_follow_parent();

/** The child's own first look (Vietnam, aged 7 or over): "Your parent can see your progress. Is that OK?" */
create function public.my_child_profile()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nickname', cp.nickname, 'country', cp.country,
    'ask_agreement', cp.country = 'VN' and extract(year from now())::int - cp.birth_year >= 7 and cp.child_agreed_at is null)
  from public.child_profiles cp where cp.user_id = auth.uid()
$$;
create function public.child_agree()
returns void language sql security definer set search_path = '' as $$
  update public.child_profiles set child_agreed_at = coalesce(child_agreed_at, now()) where user_id = auth.uid()
$$;

-- At 13: the child's own account -------------------------------------------------------------------

/** The parent gives the child's email; it gets a link to take the profile over (13 or over this year). */
create function public.start_child_graduation(p_child uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  addr text := lower(trim(coalesce(p_email, '')));
  tok text := public.new_token();
  cp public.child_profiles;
begin
  if not public.parent_of(p_child) then raise exception 'not your child' using errcode = '42501'; end if;
  if not public.recently_authenticated(10) then raise exception 'confirm it''s you first' using errcode = '42501', hint = 'reauth'; end if;
  select * into cp from public.child_profiles where user_id = p_child;
  if extract(year from now())::int - cp.birth_year < 13 then raise exception 'from 13' using errcode = 'P0001', hint = 'young'; end if;
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'not an email address' using errcode = '22023', hint = 'email'; end if;
  if exists (select 1 from auth.users where lower(email) = addr) then raise exception 'another account uses that email' using errcode = 'P0001', hint = 'taken'; end if;
  delete from public.child_graduations where child_id = p_child and done_at is null;
  insert into public.child_graduations (child_id, email, token_hash) values (p_child, addr, public.token_hash(tok));
  perform public.queue_mail(addr, 'child-account', (select lang from public.profiles where user_id = auth.uid()),
    jsonb_build_object('token', tok, 'nickname', cp.nickname), auth.uid());
end $$;

/**
 * The child (or whoever holds the email) confirms: the profile becomes an ordinary account with
 * that email; the history stays. They then set a password with "Forgot password".
 */
create function public.finish_child_graduation(p_token text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  g public.child_graduations;
begin
  select * into g from public.child_graduations where token_hash = public.token_hash(p_token) and done_at is null and created_at > now() - interval '14 days' for update;
  if not found then raise exception 'this link has expired' using errcode = 'P0002', hint = 'expired'; end if;
  if exists (select 1 from auth.users where lower(email) = g.email) then raise exception 'another account uses that email' using errcode = 'P0001', hint = 'taken'; end if;
  update auth.users set email = g.email, email_confirmed_at = now() where id = g.child_id;
  if to_regclass('auth.identities') is not null then
    execute $q$update auth.identities set identity_data = identity_data || jsonb_build_object('email', $2::text) where user_id = $1 and provider = 'email'$q$
      using g.child_id, g.email;
  end if;
  update public.child_graduations set done_at = now() where id = g.id;
  update public.child_consents set ended_at = coalesce(ended_at, now()), ended_why = coalesce(ended_why, 'own-account'), token_hash = null where child_id = g.child_id;
  delete from public.child_profiles where user_id = g.child_id;
  perform set_config('xq.moderation', 'on', true);
  update public.profiles set managed_by = null, username_chosen = false where user_id = g.child_id;
  perform set_config('xq.moderation', '', true);
  return g.email;
end $$;

-- Retention ----------------------------------------------------------------------------------------

/**
 * Daily: unconfirmed profiles go after 14 days; a profile unused for 23 months warns its parent,
 * and goes at 24; consent records go 3 years after their profile ended.
 */
create function public.child_retention()
returns int language plpgsql security definer set search_path = '' as $$
declare
  n int := 0;
  r record;
begin
  for r in select user_id from public.child_profiles where status = 'unconfirmed' and created_at < now() - interval '14 days' loop
    perform public.child_end(r.user_id, 'unconfirmed');
    n := n + 1;
  end loop;
  for r in select cp.user_id, cp.parent, cp.nickname from public.child_profiles cp join auth.users u on u.id = cp.user_id
           where cp.status = 'confirmed' and coalesce(u.last_sign_in_at, cp.created_at) < now() - interval '23 months' and cp.retention_warned_at is null loop
    perform public.queue_mail((select email from auth.users where id = r.parent), 'child-unused', (select lang from public.profiles where user_id = r.parent),
      jsonb_build_object('nickname', r.nickname), r.parent);
    update public.child_profiles set retention_warned_at = now() where user_id = r.user_id;
  end loop;
  for r in select cp.user_id from public.child_profiles cp join auth.users u on u.id = cp.user_id
           where coalesce(u.last_sign_in_at, cp.created_at) < now() - interval '24 months' and cp.retention_warned_at < now() - interval '25 days' loop
    perform public.child_end(r.user_id, 'unused');
    n := n + 1;
  end loop;
  delete from public.child_consents where ended_at < now() - interval '3 years';
  return n;
end $$;

-- A child profile signing in again counts as used: the warning is cleared.
create function public.child_used()
returns void language sql security definer set search_path = '' as $$
  update public.child_profiles set retention_warned_at = null where user_id = auth.uid() and retention_warned_at is not null
$$;

revoke all on function public.is_child(uuid), public.child_notice_version(), public.online_eligibility_base(), public.public_profile_base(text),
  public.send_feedback_base(text, text, text, text, text, boolean), public.request_coach_base(text, text, boolean, text),
  public.request_coach_by_email_base(text, boolean, text), public.child_prepare(text, int, text, text, text),
  public.child_register(uuid, uuid, text, int, text, text), public.child_consent_view(text), public.child_confirm(text), public.my_children(),
  public.parent_of(uuid), public.child_switch_check(uuid), public.child_export(uuid), public.child_end(uuid, text), public.delete_child(uuid, boolean),
  public.children_follow_parent(), public.my_child_profile(), public.child_agree(), public.start_child_graduation(uuid, text),
  public.finish_child_graduation(text), public.child_retention(), public.child_used()
  from public, anon, authenticated;
grant execute on function public.online_eligibility(), public.request_coach(text, text, boolean, text), public.request_coach_by_email(text, boolean, text),
  public.child_prepare(text, int, text, text, text), public.my_children(), public.child_switch_check(uuid), public.child_export(uuid),
  public.delete_child(uuid, boolean), public.my_child_profile(), public.child_agree(), public.start_child_graduation(uuid, text), public.child_used(),
  public.child_notice_version() to authenticated;
grant execute on function public.public_profile(text), public.send_feedback(text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.child_consent_view(text), public.child_confirm(text), public.finish_child_graduation(text) to anon, authenticated;
grant execute on function public.child_register(uuid, uuid, text, int, text, text) to service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('child-retention', '51 3 * * *', 'select public.child_retention()');
  end if;
end $$;
