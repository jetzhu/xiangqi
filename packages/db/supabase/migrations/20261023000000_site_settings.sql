-- Site settings that moderators keep up to date without a new release (2026-10-20). The first is
-- the operator's contact block the privacy policy shows: US children's privacy rules (COPPA,
-- 16 CFR 312.4(d)(1)) ask for the operator's name, postal address, phone and email. A PO box keeps
-- a home address private; the starting address is a template to be replaced.

create table public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.site_settings enable row level security;
revoke all on public.site_settings from anon, authenticated;

insert into public.site_settings (key, value) values
  ('operator_contact', jsonb_build_object(
    'name', 'Xiangqi School 象棋学堂',
    'address', 'P.O. Box 10000, Cupertino, CA 95014, USA',
    'phone', null,
    'email', 'jianjetzhu@gmail.com'));

/** The operator's contact block, for anyone (the privacy policy). */
create function public.site_contact()
returns jsonb language sql stable security definer set search_path = '' as $$
  select value from public.site_settings where key = 'operator_contact'
$$;

/** Moderators update the contact block; logged with the previous value. */
create function public.mod_set_contact(p_name text, p_address text, p_phone text, p_email text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  before jsonb := public.site_contact();
  clean jsonb;
begin
  perform public.require_moderator();
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_address), '') = '' or coalesce(trim(p_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'name, postal address and a valid email are required' using errcode = '22023';
  end if;
  clean := jsonb_build_object('name', left(trim(p_name), 120), 'address', left(trim(p_address), 300),
    'phone', nullif(left(trim(coalesce(p_phone, '')), 40), ''), 'email', left(trim(p_email), 120));
  update public.site_settings set value = clean, updated_at = now(), updated_by = auth.uid() where key = 'operator_contact';
  perform public.log_mod_action('set-contact', null, jsonb_build_object('note', p_note, 'before', before, 'after', clean));
end $$;

revoke all on function public.site_contact(), public.mod_set_contact(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.site_contact() to anon, authenticated;
grant execute on function public.mod_set_contact(text, text, text, text, text) to authenticated;
