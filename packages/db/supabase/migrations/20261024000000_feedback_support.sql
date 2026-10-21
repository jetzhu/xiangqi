-- M21 (2026-10-21, docs/v0.4-design.md): feedback from anyone, guests included, and the donation
-- links the Support page shows. Feedback has no email field: a signed-in player may allow a reply
-- to their account email, so the site never collects a child's email. Guests are rate-limited by
-- network, kept only as a hash salted afresh each day, never as an address.

create table public.feedback (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('problem', 'idea', 'content', 'translation', 'other')),
  message text not null check (length(message) between 1 and 2000),
  page text check (length(page) <= 300),
  version text check (length(version) <= 60),
  lang text check (lang in ('en', 'zh')),
  may_reply boolean not null default false,
  network text,
  status text not null default 'new' check (status in ('new', 'noted', 'planned', 'done', 'wontdo')),
  note text check (length(note) <= 1000),
  updated_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null
);
create index feedback_recent on public.feedback (status, at desc);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

-- One random salt a day; yesterday's goes, so a network's hash can't be followed across days.
create table public.feedback_salt (day date primary key, salt text not null);
alter table public.feedback_salt enable row level security;
revoke all on public.feedback_salt from anon, authenticated;

/** The caller's network, as today's salted hash ('' when the request carries no address). */
create function public.network_hash()
returns text language plpgsql security definer set search_path = '' as $$
declare
  h jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  ip text := coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', trim(split_part(h->>'x-forwarded-for', ',', 1)), '');
  s text;
begin
  if ip = '' then return ''; end if;
  delete from public.feedback_salt where day < current_date;
  insert into public.feedback_salt (day, salt) values (current_date, gen_random_uuid()::text) on conflict (day) do nothing;
  select salt into s from public.feedback_salt where day = current_date;
  return encode(sha256(convert_to(s || ip, 'utf8')), 'hex');
end $$;

/**
 * Sends feedback. 5 a day per account; for guests 5 a day per network and 100 a day in all, so a
 * flood can't bury the rest. `p_may_reply` counts only when signed in.
 */
create function public.send_feedback(p_kind text, p_message text, p_page text default null, p_version text default null, p_lang text default null, p_may_reply boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  net text := case when me is null then public.network_hash() end;
  msg text := trim(coalesce(p_message, ''));
begin
  if msg = '' then raise exception 'write something first' using errcode = '22023'; end if;
  if me is not null then
    if (select count(*) from public.feedback where user_id = me and at > now() - interval '1 day') >= 5 then
      raise exception 'feedback limit: 5 a day' using errcode = 'P0001';
    end if;
  elsif (net <> '' and (select count(*) from public.feedback where network = net and at > now() - interval '1 day') >= 5)
     or (select count(*) from public.feedback where user_id is null and at > now() - interval '1 day') >= 100 then
    raise exception 'feedback limit: 5 a day' using errcode = 'P0001';
  end if;
  insert into public.feedback (user_id, kind, message, page, version, lang, may_reply, network)
  values (me, p_kind, left(msg, 2000), left(p_page, 300), left(p_version, 60), case when p_lang in ('en', 'zh') then p_lang end,
          me is not null and coalesce(p_may_reply, false), nullif(net, ''));
end $$;

/**
 * Feedback for moderators, newest first: all open items (new, noted, planned), or one status.
 * The sender's username, and their account email only where they allowed a reply.
 */
create function public.mod_feedback(p_status text default null, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_moderator();
  return coalesce((select jsonb_agg(x order by x.at desc) from (
    select f.id, f.at, f.kind, f.message, f.page, f.version, f.lang, f.status, f.note, f.updated_at,
      p.username, case when f.may_reply then u.email end as reply_to
    from public.feedback f
    left join public.profiles p on p.user_id = f.user_id
    left join auth.users u on u.id = f.user_id
    where case when p_status is null then f.status in ('new', 'noted', 'planned') else f.status = p_status end
    order by f.at desc
    limit least(greatest(p_limit, 1), 500)
  ) x), '[]'::jsonb);
end $$;

/** Counts of feedback by status, for the tab's labels. */
create function public.mod_feedback_counts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_moderator();
  return coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from public.feedback group by status) c), '{}'::jsonb);
end $$;

/** A moderator files an item: its status and a private note. */
create function public.mod_set_feedback(p_id bigint, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_moderator();
  update public.feedback set status = p_status, note = nullif(left(trim(coalesce(p_note, '')), 1000), ''), updated_at = now(), updated_by = auth.uid()
  where id = p_id;
  if not found then raise exception 'no such feedback' using errcode = 'P0002'; end if;
end $$;

/** Feedback is kept 12 months once done or declined, 24 months otherwise. Daily. */
create function public.purge_old_feedback()
returns int language sql security definer set search_path = '' as $$
  with gone as (
    delete from public.feedback
    where (status in ('done', 'wontdo') and at < now() - interval '12 months') or at < now() - interval '24 months'
    returning 1)
  select count(*)::int from gone
$$;

-- Donation links ---------------------------------------------------------------------------------

insert into public.site_settings (key, value) values ('donations', jsonb_build_object('stripe', null, 'github', null));

/** The Support page's links (null until the owner sets them). */
create function public.site_donations()
returns jsonb language sql stable security definer set search_path = '' as $$
  select value from public.site_settings where key = 'donations'
$$;

/**
 * Moderators set the links: a Stripe Payment Link (buy.stripe.com or donate.stripe.com) and a
 * GitHub Sponsors page; an empty one hides its button. Logged with the previous value.
 */
create function public.mod_set_donations(p_stripe text, p_github text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  before jsonb := public.site_donations();
  s text := nullif(trim(coalesce(p_stripe, '')), '');
  g text := nullif(trim(coalesce(p_github, '')), '');
  clean jsonb;
begin
  perform public.require_moderator();
  if s is not null and s !~ '^https://(buy|donate)\.stripe\.com/[A-Za-z0-9_/-]+$' then
    raise exception 'the Stripe link must start https://buy.stripe.com/ or https://donate.stripe.com/' using errcode = '22023';
  end if;
  if g is not null and g !~ '^https://github\.com/sponsors/[A-Za-z0-9-]+/?$' then
    raise exception 'the GitHub link must look like https://github.com/sponsors/<name>' using errcode = '22023';
  end if;
  clean := jsonb_build_object('stripe', s, 'github', g);
  update public.site_settings set value = clean, updated_at = now(), updated_by = auth.uid() where key = 'donations';
  perform public.log_mod_action('set-donations', null, jsonb_build_object('note', p_note, 'before', before, 'after', clean));
end $$;

revoke all on function public.network_hash(), public.send_feedback(text, text, text, text, text, boolean), public.mod_feedback(text, int),
  public.mod_feedback_counts(), public.mod_set_feedback(bigint, text, text), public.purge_old_feedback(), public.site_donations(),
  public.mod_set_donations(text, text, text) from public, anon, authenticated;
grant execute on function public.send_feedback(text, text, text, text, text, boolean), public.site_donations() to anon, authenticated;
grant execute on function public.mod_feedback(text, int), public.mod_feedback_counts(), public.mod_set_feedback(bigint, text, text),
  public.mod_set_donations(text, text, text) to authenticated;

-- Daily at 03:35 UTC, where pg_cron is installed (Supabase; not the tests' in-memory Postgres).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('purge-old-feedback', '35 3 * * *', 'select public.purge_old_feedback()');
  end if;
end $$;
