-- M14: deleting an account, as chess.com does it. The player asks (after a fresh sign-in, giving
-- their username); the account then waits 10 days, and signing in during that time cancels
-- it. A daily job deletes accounts whose 10 days are up: everything goes with auth.users
-- (every table cascades from it).

create table public.account_deletions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now()
);
alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from anon, authenticated;
grant select on public.account_deletions to authenticated;
create policy "own deletion" on public.account_deletions for select to authenticated using (user_id = (select auth.uid()));

/** When the player last proved who they are (signed in), from the token's sign-in methods. */
create function public.signed_in_at() returns timestamptz
language sql stable set search_path = '' as $$
  select to_timestamp(max((m ->> 'timestamp')::bigint))
  from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) m
$$;

/**
 * Asks for the player's account to be deleted in 10 days. Needs a sign-in in the last 10
 * minutes and the username typed out. Returns when the account will be deleted.
 */
create function public.request_account_deletion(p_username text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  at timestamptz;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if coalesce(public.signed_in_at(), '-infinity') < now() - interval '10 minutes' then
    raise exception 'sign in again to confirm' using errcode = 'P0001', hint = 'reauth';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = me and lower(p.username) = lower(p_username)) then
    raise exception 'the username does not match' using errcode = 'P0001', hint = 'username';
  end if;
  insert into public.account_deletions (user_id) values (me)
  on conflict (user_id) do update set requested_at = now()
  returning requested_at into at;
  return at + interval '10 days';
end $$;

/** Cancels a deletion the player asked for (signing in again does it). True if one was pending. */
create function public.cancel_account_deletion()
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from public.account_deletions where user_id = auth.uid();
  return found;
end $$;

/** Deletes the accounts whose 10 days are up. Run daily by pg_cron; returns how many. */
create function public.purge_deleted_accounts()
returns int language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  delete from auth.users u using public.account_deletions d
  where d.user_id = u.id and d.requested_at < now() - interval '10 days';
  get diagnostics n = row_count;
  return n;
end $$;

/**
 * Removes an account made a moment ago by a Google/Microsoft/GitHub sign-in whose owner then
 * turned out to be under the minimum age: they stay a guest. Only an account under an hour
 * old that hasn't chosen its username yet.
 */
create function public.delete_new_account()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if not exists (select 1 from public.profiles p
                 where p.user_id = me and not p.username_chosen and p.created_at > now() - interval '1 hour') then
    return false;
  end if;
  delete from auth.users where id = me;
  return true;
end $$;

revoke execute on function public.signed_in_at() from public, anon;
revoke execute on function public.request_account_deletion(text) from public, anon;
revoke execute on function public.cancel_account_deletion() from public, anon;
revoke execute on function public.delete_new_account() from public, anon;
revoke execute on function public.purge_deleted_accounts() from public, anon, authenticated;
grant execute on function public.signed_in_at() to authenticated;
grant execute on function public.request_account_deletion(text) to authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;
grant execute on function public.delete_new_account() to authenticated;

-- Every day at 03:17 UTC. pg_cron exists on Supabase; the tests' in-memory Postgres has none.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('purge-deleted-accounts', '17 3 * * *', 'select public.purge_deleted_accounts()');
  end if;
end $$;
