-- M23b (2026-10-21, docs/v0.4-design.md "Account security"): linking a coach by email without
-- showing whether an address has an account; an email to a coach for each new request;
-- two-factor sign-in required for moderators; "confirm it's you" from the session's sign-in
-- times; and the site's own email change, for when the old inbox may be gone: the old address
-- approves or denies, silence approves after 10 days, a deny locks changes for 10 × 2^(denies − 1)
-- days (at most 160), two-factor skips the wait, and the old address can undo it for 30 days.

-- Helpers ----------------------------------------------------------------------------------------

/** "jetzhu@hotmail.com" as "j***@hotmail.com". */
create function public.mask_email(p_email text)
returns text language sql immutable set search_path = '' as $$
  select left(split_part(p_email, '@', 1), 1) || '***@' || split_part(p_email, '@', 2)
$$;

/** Whether the player has a verified two-factor method (Supabase's auth.mfa_factors). */
create function public.has_mfa(p_user uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  found_one boolean := false;
begin
  if to_regclass('auth.mfa_factors') is not null then
    execute 'select exists (select 1 from auth.mfa_factors where user_id = $1 and status = ''verified'')' into found_one using p_user;
  end if;
  return found_one;
end $$;

/**
 * "Confirm it's you": the session signed in (password, Google/GitHub/Microsoft, or a code) in the
 * last `p_minutes` minutes, by its sign-in times (`amr`), and with two-factor on, at that level.
 */
create function public.recently_authenticated(p_minutes int default 10)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
      select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) a
      where (a->>'timestamp')::bigint > extract(epoch from now()) - p_minutes * 60)
    and (not public.has_mfa(auth.uid()) or auth.jwt()->>'aal' = 'aal2')
$$;

/** Signs a player out everywhere (their refresh tokens go with their sessions). */
create function public.sign_out_everywhere(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user;
  end if;
end $$;

-- Two-factor sign-in for moderators ----------------------------------------------------------------

/** Raises unless the caller is a moderator signed in with two-factor ('mfa' in the hint otherwise). */
create or replace function public.require_moderator()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_moderator() then raise exception 'moderators only' using errcode = '42501'; end if;
  if coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2' then
    raise exception 'moderators need two-factor sign-in' using errcode = '42501', hint = 'mfa';
  end if;
  return auth.uid();
end $$;

-- Linking a coach by email ---------------------------------------------------------------------------

alter table public.coach_links add column via_email boolean not null default false;

-- What the student sees of a request made by email: the masked address only, until the coach accepts.
create table public.coach_email_requests (
  id bigint generated always as identity primary key,
  student uuid not null references auth.users (id) on delete cascade,
  masked text not null,
  created_at timestamptz not null default now(),
  link_id bigint references public.coach_links (id) on delete set null,
  withdrawn_at timestamptz
);
create index coach_email_requests_student on public.coach_email_requests (student, created_at desc);
alter table public.coach_email_requests enable row level security;
revoke all on public.coach_email_requests from anon, authenticated;

insert into public.triage_config (key, value) values ('coach_email_requests_day', 5), ('coach_request_mails_day', 10);

/**
 * Asks a coach by their account email. The answer is the same whether or not the address has an
 * account that can coach (the masked address), so nobody learns who is on the site. Only the
 * student's own problems are errors: no birth month, a guardian's email needed, the limits.
 */
create function public.request_coach_by_email(p_email text, p_family boolean default false, p_guardian_email text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  sp public.profiles;
  addr text := lower(trim(coalesce(p_email, '')));
  gmail text := lower(trim(coalesce(p_guardian_email, '')));
  needs boolean;
  c uuid;
  tok text;
  link bigint;
  st text;
  req bigint;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into sp from public.profiles where user_id = me;
  if public.birth_month_now(sp) is null then raise exception 'birth month first' using errcode = 'P0001', hint = 'birth-month'; end if;
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'not an email address' using errcode = '22023', hint = 'email'; end if;
  if (select count(*) from public.coach_email_requests where student = me and created_at > now() - interval '1 day') >= public.triage_value('coach_email_requests_day') then
    raise exception 'email requests: 5 a day' using errcode = 'P0001', hint = 'email-limit';
  end if;
  if addr = lower((select u.email from auth.users u where u.id = me)) then raise exception 'not yourself' using errcode = 'P0001', hint = 'self'; end if;
  needs := public.needs_guardian(me);
  if needs then
    if gmail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'a guardian''s email is needed' using errcode = 'P0001', hint = 'guardian-email'; end if;
    if gmail = lower((select u.email from auth.users u where u.id = me)) then raise exception 'that''s your own email' using errcode = 'P0001', hint = 'guardian-self'; end if;
    if (select count(*) from public.mail_outbox where user_id = me and template = 'guardian-confirm' and created_at > now() - interval '1 day') >= public.triage_value('guardian_mails_day') then
      raise exception 'guardian emails: 3 a day' using errcode = 'P0001', hint = 'mail-limit';
    end if;
  end if;
  if (select count(*) from public.coach_links where student = me and status in ('guardian', 'coach', 'review')) >= public.triage_value('coach_requests_open') then
    raise exception 'too many requests waiting' using errcode = 'P0001', hint = 'requests';
  end if;
  insert into public.coach_email_requests (student, masked) values (me, public.mask_email(addr)) returning id into req;

  -- Silently nothing unless the address belongs to someone who can coach this player now.
  select u.id into c from auth.users u where lower(u.email) = addr and u.email_confirmed_at is not null;
  if c is null or c = me or public.coach_problem(c) is not null
     or exists (select 1 from public.coach_links where coach = c and student = me and status in ('guardian', 'coach', 'review', 'active'))
     or (p_family and (select count(*) from public.coach_links where coach = c and kind = 'family' and status in ('guardian', 'coach', 'review', 'active')) >= public.triage_value('family_cap')) then
    return jsonb_build_object('masked', public.mask_email(addr));
  end if;
  st := case when needs then 'guardian' else 'coach' end;
  if needs then tok := public.new_token(); end if;
  insert into public.coach_links (coach, student, kind, status, guardian_email, guardian_hash, token_hash, token_expires, under16, via_email)
  values (c, me, case when p_family then 'family' else 'coach' end, st,
    case when needs then gmail end, case when needs then public.token_hash(gmail) end,
    case when needs then public.token_hash(tok) end, case when needs then now() + interval '14 days' end, public.is_under16(sp), true)
  returning id into link;
  update public.coach_email_requests set link_id = link where id = req;
  if needs then
    -- The guardian sees the masked address, not the username, so a second address of the
    -- child's can't be used to look people up.
    perform public.queue_mail(gmail, 'guardian-confirm', sp.lang,
      jsonb_build_object('student', sp.username, 'coach', public.mask_email(addr), 'family', p_family, 'token', tok), me);
  end if;
  return jsonb_build_object('masked', public.mask_email(addr));
end $$;

/** The student withdraws a request made by email (ending its link, if there is one). */
create function public.withdraw_email_request(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.coach_email_requests;
begin
  select * into r from public.coach_email_requests where id = p_id and student = me and withdrawn_at is null;
  if not found then raise exception 'no such request' using errcode = 'P0002'; end if;
  update public.coach_email_requests set withdrawn_at = now() where id = r.id;
  update public.coach_links set status = 'ended', ended_at = now(), ended_by = 'student', guardian_email = null
  where id = r.link_id and status in ('guardian', 'coach', 'review', 'active');
end $$;

-- The coaching page: a link made by email shows only as its request until the coach accepts.
create or replace function public.my_coaching()
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
      where l.student = me and not (l.via_email and l.accepted_at is null)
        and (l.status in ('guardian', 'coach', 'review', 'active') or l.ended_at > now() - interval '90 days')), '[]'::jsonb),
    'email_requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'masked', r.masked, 'created_at', r.created_at) order by r.created_at desc)
      from public.coach_email_requests r left join public.coach_links l on l.id = r.link_id
      where r.student = me and r.withdrawn_at is null and r.created_at > now() - interval '30 days'
        and (l.id is null or l.accepted_at is null)), '[]'::jsonb),
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

-- A request reaching the coach (made, or confirmed by the guardian) emails them, 10 a day at most.
create function public.coach_links_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'coach' and (tg_op = 'INSERT' or old.status is distinct from 'coach')
     and (select count(*) from public.mail_outbox where user_id = new.coach and template = 'coach-request' and created_at > now() - interval '1 day')
         < public.triage_value('coach_request_mails_day') then
    perform public.queue_mail((select email from auth.users where id = new.coach), 'coach-request',
      (select lang from public.profiles where user_id = new.coach), '{}'::jsonb, new.coach);
  end if;
  return new;
end $$;
create trigger coach_links_notify after insert or update of status on public.coach_links for each row execute function public.coach_links_notify();

-- Changing the account email ------------------------------------------------------------------------

-- Unsent mail about something that ended (a cancelled email change's reminders) is withdrawn by key.
alter table public.mail_outbox add column cancel_key text;
create index mail_outbox_cancel on public.mail_outbox (cancel_key) where sent_at is null;

create table public.email_changes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  old_email text not null,
  new_email text not null,
  -- confirm-new: waiting for the new address; waiting: for the old address or the 10 days;
  -- done; denied, cancelled, expired; disputed (undone from the old address, a moderator decides).
  status text not null check (status in ('confirm-new', 'waiting', 'done', 'denied', 'cancelled', 'expired', 'disputed', 'restored')),
  -- Two-factor at the start: the change completes as soon as the new address is confirmed.
  fast boolean not null default false,
  new_token_hash text unique,
  old_token_hash text unique,
  undo_token_hash text unique,
  created_at timestamptz not null default now(),
  new_confirmed_at timestamptz,
  due_at timestamptz,
  done_at timestamptz,
  undo_until timestamptz
);
create index email_changes_user on public.email_changes (user_id, created_at desc);
create unique index email_changes_one_open on public.email_changes (user_id) where status in ('confirm-new', 'waiting');
alter table public.email_changes enable row level security;
revoke all on public.email_changes from anon, authenticated;

create table public.email_change_locks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  denies int not null default 0,
  locked_until timestamptz,
  -- Undone from the old address: no changes until a moderator looks.
  frozen boolean not null default false
);
alter table public.email_change_locks enable row level security;
revoke all on public.email_change_locks from anon, authenticated;

insert into public.triage_config (key, value) values ('email_change_wait_days', 10), ('email_change_lock_days', 10), ('email_change_lock_max', 160);

/**
 * Starts a change to `p_new`, after "confirm it's you". Not while locked or frozen, not with
 * another change open, not to an address another account uses. The new address gets a link.
 */
create function public.start_email_change(p_new text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  addr text := lower(trim(coalesce(p_new, '')));
  old text;
  l public.email_change_locks;
  tok text := public.new_token();
  new_id bigint;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not public.recently_authenticated(10) then raise exception 'confirm it''s you first' using errcode = '42501', hint = 'reauth'; end if;
  select * into l from public.email_change_locks where user_id = me;
  if l.frozen then raise exception 'email changes are frozen' using errcode = 'P0001', hint = 'frozen'; end if;
  if l.locked_until > now() then raise exception 'email changes are locked until %', l.locked_until using errcode = 'P0001', hint = 'locked'; end if;
  if exists (select 1 from public.email_changes where user_id = me and status in ('confirm-new', 'waiting')) then
    raise exception 'a change is already under way' using errcode = 'P0001', hint = 'pending';
  end if;
  select email into old from auth.users where id = me;
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'not an email address' using errcode = '22023', hint = 'email'; end if;
  if addr = lower(old) then raise exception 'that''s your email already' using errcode = 'P0001', hint = 'same'; end if;
  if exists (select 1 from auth.users where lower(email) = addr) then raise exception 'another account uses that email' using errcode = 'P0001', hint = 'taken'; end if;
  insert into public.email_changes (user_id, old_email, new_email, status, fast, new_token_hash)
  values (me, old, addr, 'confirm-new', public.has_mfa(me) and auth.jwt()->>'aal' = 'aal2', public.token_hash(tok))
  returning email_changes.id into new_id;
  perform public.queue_mail(addr, 'email-change-new', (select lang from public.profiles where user_id = me),
    jsonb_build_object('token', tok, 'username', (select username from public.profiles where user_id = me)), me);
  return jsonb_build_object('id', new_id, 'status', 'confirm-new');
end $$;

/** Ends the open change's unsent mail. */
create function public.withdraw_change_mail(p_change bigint)
returns void language sql security definer set search_path = '' as $$
  delete from public.mail_outbox where cancel_key = 'email-change:' || p_change and sent_at is null
$$;

/**
 * Makes the change: the account's email (and its email sign-in) becomes the new address; the old
 * address gets "Wasn't you?" for 30 days; the deny count starts again.
 */
create function public.complete_email_change(p_change bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.email_changes;
  tok text := public.new_token();
  ulang text;
begin
  select * into c from public.email_changes where id = p_change and status in ('confirm-new', 'waiting') for update;
  if not found then return; end if;
  if exists (select 1 from auth.users where lower(email) = c.new_email and id <> c.user_id) then
    update public.email_changes set status = 'expired' where id = c.id;
    return;
  end if;
  update auth.users set email = c.new_email where id = c.user_id;
  if to_regclass('auth.identities') is not null then
    execute $q$update auth.identities set identity_data = identity_data || jsonb_build_object('email', $2::text)
      where user_id = $1 and provider = 'email'$q$ using c.user_id, c.new_email;
  end if;
  update public.email_changes set status = 'done', done_at = now(), undo_token_hash = public.token_hash(tok), undo_until = now() + interval '30 days' where id = c.id;
  perform public.withdraw_change_mail(c.id);
  update public.email_change_locks set denies = 0, locked_until = null where user_id = c.user_id;
  select p.lang into ulang from public.profiles p where p.user_id = c.user_id;
  perform public.queue_mail(c.old_email, 'email-changed', ulang, jsonb_build_object('token', tok, 'new', public.mask_email(c.new_email)), c.user_id);
  perform public.queue_mail(c.new_email, 'email-change-done', ulang, '{}'::jsonb, c.user_id);
  insert into public.mod_log (moderator, action, target, details) values (null, 'email-change', c.user_id, jsonb_build_object('change', c.id, 'fast', c.fast));
end $$;

/** A change by any of its links (new, old or undo), with which link it is. */
create function public.change_by_token(p_token text)
returns table (change_id bigint, kind text) language sql stable security definer set search_path = '' as $$
  select c.id, case public.token_hash(p_token) when c.new_token_hash then 'new' when c.old_token_hash then 'old' else 'undo' end
  from public.email_changes c
  where public.token_hash(p_token) in (c.new_token_hash, c.old_token_hash, c.undo_token_hash)
$$;

/** What the email-change page shows for a link: which one it is, the change's state, masked addresses. */
create function public.email_change_view(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.email_changes;
  cid bigint;
  k text;
begin
  select x.change_id, x.kind into cid, k from public.change_by_token(p_token) x;
  select * into c from public.email_changes where id = cid;
  if c.id is null then return null; end if;
  return jsonb_build_object('kind', k, 'status', c.status, 'old', public.mask_email(c.old_email), 'new', public.mask_email(c.new_email),
    'username', (select username from public.profiles where user_id = c.user_id), 'due_at', c.due_at, 'undo_until', c.undo_until,
    'expired', case k when 'new' then c.created_at < now() - interval '7 days' when 'undo' then c.undo_until < now() else false end);
end $$;

/** The new address is confirmed: done at once after two-factor, otherwise the old address is asked (10 days). */
create function public.confirm_new_email(p_token text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  c public.email_changes;
  cid bigint;
  k text;
  tok text := public.new_token();
  due timestamptz := now() + make_interval(days => public.triage_value('email_change_wait_days')::int);
  ulang text;
  mdata jsonb;
  mail_id bigint;
begin
  select x.change_id, x.kind into cid, k from public.change_by_token(p_token) x;
  select * into c from public.email_changes where id = cid;
  if c.id is null or k <> 'new' or c.status <> 'confirm-new' or c.created_at < now() - interval '7 days' then
    raise exception 'this link has expired' using errcode = 'P0002', hint = 'expired';
  end if;
  if c.fast then
    perform public.complete_email_change(c.id);
    return 'done';
  end if;
  update public.email_changes set status = 'waiting', new_confirmed_at = now(), due_at = due, old_token_hash = public.token_hash(tok) where id = c.id;
  select p.lang into ulang from public.profiles p where p.user_id = c.user_id;
  mdata := jsonb_build_object('token', tok, 'new', public.mask_email(c.new_email), 'due', due);
  mail_id := public.queue_mail(c.old_email, 'email-change-old', ulang, mdata, c.user_id);
  update public.mail_outbox set cancel_key = 'email-change:' || c.id where id = mail_id;
  -- Reminders on days 1, 5 and 9, withdrawn when the change ends.
  insert into public.mail_outbox (to_email, template, lang, data, user_id, send_after, cancel_key)
  select c.old_email, 'email-change-old', coalesce(ulang, 'en'), mdata || jsonb_build_object('reminder', true), c.user_id, now() + make_interval(days => d), 'email-change:' || c.id
  from unnest(array[1, 5, 9]) d;
  return 'waiting';
end $$;

/**
 * The old address answers. Approve: done now. Deny: cancelled, every device signed out, and no
 * changes for 10 × 2^(denies − 1) days, at most 160.
 */
create function public.answer_old_email(p_token text, p_approve boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  c public.email_changes;
  cid bigint;
  k text;
  n int;
  days int;
begin
  select x.change_id, x.kind into cid, k from public.change_by_token(p_token) x;
  select * into c from public.email_changes where id = cid;
  if c.id is null or k <> 'old' or c.status <> 'waiting' then raise exception 'this link has expired' using errcode = 'P0002', hint = 'expired'; end if;
  if p_approve then
    perform public.complete_email_change(c.id);
    return 'done';
  end if;
  update public.email_changes set status = 'denied' where id = c.id;
  perform public.withdraw_change_mail(c.id);
  insert into public.email_change_locks (user_id, denies) values (c.user_id, 1)
  on conflict (user_id) do update set denies = public.email_change_locks.denies + 1
  returning denies into n;
  days := least(public.triage_value('email_change_lock_max'), public.triage_value('email_change_lock_days') * power(2, n - 1))::int;
  update public.email_change_locks set locked_until = now() + make_interval(days => days) where user_id = c.user_id;
  perform public.sign_out_everywhere(c.user_id);
  perform public.queue_mail(c.old_email, 'email-change-denied', (select lang from public.profiles where user_id = c.user_id),
    jsonb_build_object('days', days), c.user_id);
  insert into public.mod_log (moderator, action, target, details) values (null, 'email-change-denied', c.user_id, jsonb_build_object('change', c.id, 'locked_days', days));
  return 'denied';
end $$;

/** "Wasn't you?" from the old address within 30 days: changes frozen, devices signed out, moderators alerted. */
create function public.undo_email_change(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.email_changes;
  cid bigint;
  k text;
begin
  select x.change_id, x.kind into cid, k from public.change_by_token(p_token) x;
  select * into c from public.email_changes where id = cid;
  if c.id is null or k <> 'undo' or c.status <> 'done' or c.undo_until < now() then raise exception 'this link has expired' using errcode = 'P0002', hint = 'expired'; end if;
  update public.email_changes set status = 'disputed' where id = c.id;
  insert into public.email_change_locks (user_id, frozen) values (c.user_id, true) on conflict (user_id) do update set frozen = true;
  perform public.sign_out_everywhere(c.user_id);
  insert into public.mod_log (moderator, action, target, details) values (null, 'email-change-disputed', c.user_id, jsonb_build_object('change', c.id));
end $$;

/** The player cancels their open change. */
create function public.cancel_email_change()
returns void language plpgsql security definer set search_path = '' as $$
declare
  gone bigint;
begin
  update public.email_changes set status = 'cancelled' where user_id = auth.uid() and status in ('confirm-new', 'waiting') returning email_changes.id into gone;
  if gone is null then raise exception 'no change under way' using errcode = 'P0002'; end if;
  perform public.withdraw_change_mail(gone);
end $$;

/** The player's open change (for Settings and the banner), and any lock or freeze. */
create function public.my_email_change()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'change', (select jsonb_build_object('status', c.status, 'new', public.mask_email(c.new_email), 'due_at', c.due_at, 'fast', c.fast)
               from public.email_changes c where c.user_id = auth.uid() and c.status in ('confirm-new', 'waiting')),
    'locked_until', (select locked_until from public.email_change_locks where user_id = auth.uid() and locked_until > now()),
    'frozen', coalesce((select frozen from public.email_change_locks where user_id = auth.uid()), false),
    'mfa', public.has_mfa(auth.uid()))
$$;

/** Hourly: changes whose 10 days are up complete; unconfirmed ones lapse after 7 days. */
create function public.complete_due_email_changes()
returns int language plpgsql security definer set search_path = '' as $$
declare
  n int := 0;
  r record;
begin
  update public.email_changes set status = 'expired' where status = 'confirm-new' and created_at < now() - interval '7 days';
  for r in select id from public.email_changes where status = 'waiting' and due_at <= now() loop
    perform public.complete_email_change(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

/** Disputed changes, locks and freezes, for moderators. */
create function public.mod_email_changes()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_moderator();
  return jsonb_build_object(
    'disputed', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'username', p.username, 'old', c.old_email, 'new', c.new_email, 'done_at', c.done_at) order by c.done_at)
      from public.email_changes c join public.profiles p on p.user_id = c.user_id where c.status = 'disputed'), '[]'::jsonb),
    'locks', coalesce((select jsonb_agg(jsonb_build_object('username', p.username, 'denies', l.denies, 'locked_until', l.locked_until, 'frozen', l.frozen))
      from public.email_change_locks l join public.profiles p on p.user_id = l.user_id where l.frozen or l.locked_until > now()), '[]'::jsonb));
end $$;

/**
 * A moderator settles a disputed change: 'restore' puts the old email back (and signs the account
 * out everywhere), 'keep' leaves the new one; either way the freeze lifts. Logged.
 */
create function public.mod_settle_email_change(p_change bigint, p_restore boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.email_changes;
begin
  perform public.require_moderator();
  select * into c from public.email_changes where id = p_change and status = 'disputed' for update;
  if not found then raise exception 'no such disputed change' using errcode = 'P0002'; end if;
  if p_restore then
    if exists (select 1 from auth.users where lower(email) = lower(c.old_email) and id <> c.user_id) then
      raise exception 'another account now uses the old email' using errcode = 'P0001';
    end if;
    update auth.users set email = c.old_email where id = c.user_id;
    if to_regclass('auth.identities') is not null then
      execute $q$update auth.identities set identity_data = identity_data || jsonb_build_object('email', $2::text)
        where user_id = $1 and provider = 'email'$q$ using c.user_id, c.old_email;
    end if;
    perform public.sign_out_everywhere(c.user_id);
  end if;
  update public.email_changes set status = case when p_restore then 'restored' else 'done' end, undo_until = now() where id = c.id;
  update public.email_change_locks set frozen = false where user_id = c.user_id;
  perform public.log_mod_action(case when p_restore then 'email-restore' else 'email-keep' end, c.user_id, jsonb_build_object('change', c.id, 'note', p_note));
end $$;

/** A moderator lifts a player's email-change lock or freeze (logged). */
create function public.mod_unlock_email(p_username text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  u uuid := (select user_id from public.profiles where lower(username) = lower(p_username));
begin
  perform public.require_moderator();
  update public.email_change_locks set locked_until = null, frozen = false where user_id = u;
  if not found then raise exception 'no lock on that player' using errcode = 'P0002'; end if;
  perform public.log_mod_action('email-unlock', u, jsonb_build_object('note', p_note));
end $$;

revoke all on function public.mask_email(text), public.has_mfa(uuid), public.recently_authenticated(int), public.sign_out_everywhere(uuid),
  public.request_coach_by_email(text, boolean, text), public.withdraw_email_request(bigint), public.coach_links_notify(),
  public.start_email_change(text), public.withdraw_change_mail(bigint), public.complete_email_change(bigint), public.change_by_token(text),
  public.email_change_view(text), public.confirm_new_email(text), public.answer_old_email(text, boolean), public.undo_email_change(text),
  public.cancel_email_change(), public.my_email_change(), public.complete_due_email_changes(), public.mod_email_changes(),
  public.mod_settle_email_change(bigint, boolean, text), public.mod_unlock_email(text, text)
  from public, anon, authenticated;
grant execute on function public.request_coach_by_email(text, boolean, text), public.withdraw_email_request(bigint), public.start_email_change(text),
  public.cancel_email_change(), public.my_email_change(), public.recently_authenticated(int), public.mod_email_changes(),
  public.mod_settle_email_change(bigint, boolean, text), public.mod_unlock_email(text, text) to authenticated;
-- The email's links are their own keys: no account needed (the old inbox's owner may be signed out).
grant execute on function public.email_change_view(text), public.confirm_new_email(text), public.answer_old_email(text, boolean),
  public.undo_email_change(text) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('complete-email-changes', '23 * * * *', 'select public.complete_due_email_changes()');
  end if;
end $$;
