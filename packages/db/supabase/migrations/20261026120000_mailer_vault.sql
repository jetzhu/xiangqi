-- The mailer's settings live in Supabase Vault (encrypted in the database) instead of function
-- secrets, so setting them up needs no extra token permission (2026-10-21). scripts/mail-setup.mjs
-- stores them as vault secrets named mailer_*; only the server can read them, through this.

/** The mailer's settings: SMTP and sender from the vault, and the key the database pokes it with. */
create function public.mailer_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  out jsonb := '{}';
begin
  if exists (select 1 from pg_namespace where nspname = 'vault') then
    execute $q$select coalesce(jsonb_object_agg(substr(name, 8), decrypted_secret), '{}') from vault.decrypted_secrets where name like 'mailer\_%'$q$ into out;
  end if;
  return out || jsonb_build_object('key', (select value from public.mailer_config where key = 'key'));
end $$;
revoke all on function public.mailer_settings() from public, anon, authenticated;
grant execute on function public.mailer_settings() to service_role;
