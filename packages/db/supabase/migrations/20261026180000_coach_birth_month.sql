-- A player with no birth month can't coach, but the reason to give them is the missing month,
-- not their age (2026-10-21, found in the live test: an adult without a birth month was told
-- "coaches must be 18 or over").

/** Why a player can't coach yet ('birth', 'age', 'email', 'new', 'barred'), or null when they can. */
create or replace function public.coach_problem(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when public.birth_month_now(p) is null then 'birth'
    when not public.is_adult(p) then 'age'
    when u.email_confirmed_at is null then 'email'
    when p.created_at > now() - interval '7 days' then 'new'
    when p.coach_barred then 'barred'
  end
  from public.profiles p join auth.users u on u.id = p.user_id where p.user_id = p_user
$$;
