-- Google, Microsoft and GitHub sign-ups arrive without a username and get a placeholder
-- ("player-4821936"). Record whether the player chose their name, so the site can ask once;
-- that first choice doesn't start the 90-day wait between username changes.

alter table public.profiles add column username_chosen boolean not null default false;
update public.profiles set username_chosen = username !~ '^player-[0-9]{7}$';

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  wanted text := new.raw_user_meta_data ->> 'username';
  chosen text := wanted;
  lang text := coalesce(nullif(new.raw_user_meta_data ->> 'lang', ''), 'zh');
begin
  if lang not in ('zh', 'en') then lang := 'zh'; end if;
  while public.username_problem(chosen) is not null loop
    chosen := 'player-' || (1000000 + floor(random() * 9000000))::int;
  end loop;
  insert into public.profiles (user_id, username, lang, username_chosen)
    values (new.id, chosen, lang, chosen is not distinct from wanted);
  return new;
end
$$;

create or replace function public.profiles_before_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  if new.username is distinct from old.username then
    if old.username_chosen and old.username_changed_at is not null and old.username_changed_at > now() - interval '90 days' then
      raise exception 'username can be changed once every 90 days' using errcode = 'P0001', hint = 'too_soon';
    end if;
    if public.username_problem(new.username, old.user_id) is not null then
      raise exception 'username not allowed: %', public.username_problem(new.username, old.user_id)
        using errcode = 'P0001', hint = public.username_problem(new.username, old.user_id);
    end if;
    -- Replacing the placeholder is choosing a name, not changing one.
    new.username_changed_at := case when old.username_chosen then now() else old.username_changed_at end;
    new.username_chosen := true;
  else
    new.username_changed_at := old.username_changed_at;
    new.username_chosen := old.username_chosen;
  end if;
  return new;
end
$$;
