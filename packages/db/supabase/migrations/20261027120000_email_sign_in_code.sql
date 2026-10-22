-- M23b, added 2026-10-22: a code by email as a basic second step, for players who don't want an
-- authenticator app or a passkey. Like those, it is asked only before sensitive changes (the
-- email, sign-in protection, later child profiles), never to sign in or play (the owner's choice,
-- as chess.com does). It isn't two-factor in Supabase's sense (the session stays at aal1): it
-- never counts for moderators or skips the email change's wait. The database refuses "confirm
-- it's you" until this session has given it.

alter table public.profiles add column email_code_sign_in boolean not null default false;

-- Sessions that gave their emailed code (Supabase's session id, from the token).
create table public.session_checks (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  verified_at timestamptz not null default now()
);
alter table public.session_checks enable row level security;
revoke all on public.session_checks from anon, authenticated;

-- The code waiting for a session: only its hash, 10 minutes, 5 tries.
create table public.sign_in_codes (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts int not null default 0
);
alter table public.sign_in_codes enable row level security;
revoke all on public.sign_in_codes from anon, authenticated;

/** The session id in the caller's token. */
create function public.current_session()
returns uuid language sql stable set search_path = '' as $$
  select nullif(auth.jwt()->>'session_id', '')::uuid
$$;

/** Whether this session still owes its emailed code (the setting is on, no code yet, not two-factor). */
create function public.email_code_needed()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.email_code_sign_in from public.profiles p where p.user_id = auth.uid()), false)
    and coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2'
    and not exists (select 1 from public.session_checks c where c.session_id = public.current_session())
$$;

-- "Confirm it's you" now also needs the emailed code, when the player asked for one.
create or replace function public.recently_authenticated(p_minutes int default 10)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
      select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) a
      where (a->>'timestamp')::bigint > extract(epoch from now()) - p_minutes * 60)
    and (not public.has_mfa(auth.uid()) or auth.jwt()->>'aal' = 'aal2')
    and not public.email_code_needed()
$$;

/** Turns the emailed code on or off, after "confirm it's you" (and so, to turn it off, the code). */
create function public.set_email_code_sign_in(p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not public.recently_authenticated(10) then raise exception 'confirm it''s you first' using errcode = '42501', hint = 'reauth'; end if;
  update public.profiles set email_code_sign_in = p_on where user_id = auth.uid();
  -- Turning it on from this session counts as this session's check.
  if p_on and public.current_session() is not null then
    insert into public.session_checks (session_id, user_id) values (public.current_session(), auth.uid()) on conflict do nothing;
  end if;
end $$;

/**
 * Emails this session a 6-digit code, valid 10 minutes: at most one a minute and 10 a day. The
 * mailer is asked at once rather than at the next minute.
 */
create function public.send_sign_in_code()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  sid uuid := public.current_session();
  code text := lpad(floor(random() * 1000000)::int::text, 6, '0');
  addr text;
begin
  if me is null or sid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not public.email_code_needed() then return jsonb_build_object('needed', false); end if;
  if exists (select 1 from public.sign_in_codes where session_id = sid and sent_at > now() - interval '1 minute') then
    raise exception 'wait a minute before asking again' using errcode = 'P0001', hint = 'wait';
  end if;
  if (select count(*) from public.mail_outbox where user_id = me and template = 'sign-in-code' and created_at > now() - interval '1 day') >= 10 then
    raise exception 'sign-in codes: 10 a day' using errcode = 'P0001', hint = 'code-limit';
  end if;
  select email into addr from auth.users where id = me;
  insert into public.sign_in_codes (session_id, user_id, code_hash, expires_at)
  values (sid, me, public.token_hash(sid::text || code), now() + interval '10 minutes')
  on conflict (session_id) do update set code_hash = excluded.code_hash, sent_at = now(), expires_at = excluded.expires_at, attempts = 0;
  perform public.queue_mail(addr, 'sign-in-code', (select lang from public.profiles where user_id = me), jsonb_build_object('code', code), me);
  begin
    perform public.poke_mailer();
  exception when others then
    null; -- the minute job sends it anyway
  end;
  return jsonb_build_object('needed', true, 'to', public.mask_email(addr));
end $$;

/** Checks the emailed code; five wrong tries end it (ask for a new one). */
create function public.verify_sign_in_code(p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  sid uuid := public.current_session();
  c public.sign_in_codes;
begin
  select * into c from public.sign_in_codes where session_id = sid for update;
  if not found or c.expires_at < now() or c.attempts >= 5 then raise exception 'ask for a new code' using errcode = 'P0001', hint = 'expired'; end if;
  if c.code_hash <> public.token_hash(sid::text || trim(coalesce(p_code, ''))) then
    update public.sign_in_codes set attempts = attempts + 1 where session_id = sid;
    return false;
  end if;
  delete from public.sign_in_codes where session_id = sid;
  insert into public.session_checks (session_id, user_id) values (sid, c.user_id) on conflict do nothing;
  return true;
end $$;

/** Whether the site should ask this session for its emailed code. */
create function public.my_sign_in_check()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email_code', coalesce((select email_code_sign_in from public.profiles where user_id = auth.uid()), false),
    'needed', public.email_code_needed())
$$;

/** Daily: checks of sessions that have ended, and old codes, go. */
create function public.purge_session_checks()
returns int language plpgsql security definer set search_path = '' as $$
declare
  n int := 0;
begin
  delete from public.sign_in_codes where expires_at < now() - interval '1 day';
  delete from public.session_checks where verified_at < now() - interval '30 days';
  if to_regclass('auth.sessions') is not null then
    execute $q$with gone as (delete from public.session_checks c where not exists (select 1 from auth.sessions s where s.id = c.session_id) returning 1)
      select count(*)::int from gone$q$ into n;
  end if;
  return n;
end $$;

revoke all on function public.current_session(), public.email_code_needed(), public.set_email_code_sign_in(boolean), public.send_sign_in_code(),
  public.verify_sign_in_code(text), public.my_sign_in_check(), public.purge_session_checks() from public, anon, authenticated;
grant execute on function public.set_email_code_sign_in(boolean), public.send_sign_in_code(), public.verify_sign_in_code(text), public.my_sign_in_check()
  to authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('purge-session-checks', '47 3 * * *', 'select public.purge_session_checks()');
  end if;
end $$;
