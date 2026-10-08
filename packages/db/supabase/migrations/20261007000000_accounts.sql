-- v0.2 accounts: profiles, settings, progress, game and puzzle records, ratings, analyses.
-- Every row has one owner (user_id). Row-level security lets a signed-in user read and
-- write only their own rows. Ratings, bot games and puzzle attempts are read-only from the
-- browser: only server functions (service role, which bypasses RLS) write them, so nobody
-- can edit their own rating from the console.

-- Usernames ------------------------------------------------------------------------------

-- Names nobody may take (staff, bots, site words), compared ignoring case.
-- Profanity and political terms are added by later migrations as the list grows.
create table public.reserved_usernames (name text primary key);
alter table public.reserved_usernames enable row level security; -- no policies: unreadable from the browser
insert into public.reserved_usernames (name) values
  ('admin'), ('administrator'), ('root'), ('staff'), ('support'), ('help'), ('moderator'), ('mod'),
  ('system'), ('official'), ('xiangqi'), ('xiangqischool'), ('guest'), ('anonymous'), ('null'),
  ('undefined'), ('bot'), ('engine'), ('pikafish'), ('stockfish'), ('fairystockfish'),
  ('xiaobing'), ('afu'), ('xiaoyu'), ('laochen'), ('meiling'), ('aqiang'), ('teacherlin'), ('longwang'),
  ('管理员'), ('客服'), ('官方'), ('系统');

-- Profiles -------------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  avatar text,
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  lang text not null default 'zh' check (lang in ('zh', 'en')),
  created_at timestamptz not null default now(),
  username_changed_at timestamptz
);
create unique index profiles_username_key on public.profiles (lower(username));

-- Why a name can't be used: 'format', 'digits', 'reserved', 'taken', or null when it can.
-- Rules as chess.com: 3–20 letters, digits, _ or -, starting and ending with a letter or
-- digit, not all digits, unique ignoring case. `for_user` may keep their own name.
create function public.username_problem(name text, for_user uuid default null)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when name is null or name !~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,18}[A-Za-z0-9]$' then 'format'
    when name ~ '^[0-9]+$' then 'digits'
    when exists (select 1 from public.reserved_usernames r where r.name = lower(username_problem.name)) then 'reserved'
    when exists (select 1 from public.profiles p where lower(p.username) = lower(username_problem.name)
                 and p.user_id is distinct from for_user) then 'taken'
  end
$$;

-- The browser may change only these columns, and the username once every 90 days.
create function public.profiles_before_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  if new.username is distinct from old.username then
    if old.username_changed_at is not null and old.username_changed_at > now() - interval '90 days' then
      raise exception 'username can be changed once every 90 days' using errcode = 'P0001', hint = 'too_soon';
    end if;
    if public.username_problem(new.username, old.user_id) is not null then
      raise exception 'username not allowed: %', public.username_problem(new.username, old.user_id)
        using errcode = 'P0001', hint = public.username_problem(new.username, old.user_id);
    end if;
    new.username_changed_at := now();
  else
    new.username_changed_at := old.username_changed_at;
  end if;
  return new;
end
$$;
create trigger profiles_before_update before update on public.profiles
  for each row execute function public.profiles_before_update();

-- A profile is made with every new user (email sign-up or, from M10, Google/Apple/GitHub).
-- The sign-up form checks the username first; if it is missing or no longer free, a
-- placeholder like "player-4821936" is used and the player can change it right away.
create function public.handle_new_user()
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
  insert into public.profiles (user_id, username, lang) values (new.id, chosen, lang);
  return new;
end
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Settings and progress (written by the browser) -----------------------------------------

create table public.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.lesson_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id text not null,
  status text not null check (status in ('new', 'started', 'mastered')),
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

-- Lesson status never goes down (mastered > started > new), whatever a device sends.
create function public.lesson_progress_keep_best()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  rank_of constant jsonb := '{"new": 0, "started": 1, "mastered": 2}';
begin
  if (rank_of ->> new.status)::int < (rank_of ->> old.status)::int then
    new.status := old.status;
  end if;
  return new;
end
$$;
create trigger lesson_progress_keep_best before update on public.lesson_progress
  for each row execute function public.lesson_progress_keep_best();

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '' check (length(title) <= 200),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index analyses_user_idx on public.analyses (user_id, updated_at desc);

-- Records and ratings (written only by server functions) ---------------------------------

create table public.bot_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  bot_id text not null,
  bot_rating int not null,
  player_color text not null check (player_color in ('red', 'black')),
  moves text[] not null,
  result text check (result in ('win', 'loss', 'draw')),
  reason text,
  rated boolean not null default false,
  rating_before int,
  rating_after int,
  stars int,
  accuracy real,
  review jsonb,
  started_at timestamptz not null,
  ended_at timestamptz
);
create index bot_games_user_idx on public.bot_games (user_id, started_at desc);

create table public.puzzle_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  puzzle_id text not null,
  score real not null check (score between 0 and 1),
  rated boolean not null default true,
  rating_after int,
  at timestamptz not null default now()
);
create index puzzle_attempts_user_idx on public.puzzle_attempts (user_id, at desc);

create table public.ratings (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('bot', 'puzzle', 'online')),
  rating real not null,
  rd real not null,
  games int not null default 0,
  peak real,
  peak_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

-- Access ---------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.analyses enable row level security;
alter table public.bot_games enable row level security;
alter table public.puzzle_attempts enable row level security;
alter table public.ratings enable row level security;

-- Supabase grants everything on public tables to anon and authenticated by default; take it
-- back and grant only what the site uses, so RLS is a second lock rather than the only one.
revoke all on public.reserved_usernames, public.profiles, public.settings, public.lesson_progress,
  public.analyses, public.bot_games, public.puzzle_attempts, public.ratings from anon, authenticated;
revoke all on function public.username_problem(text, uuid) from public;
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.username_problem(text, uuid) to anon, authenticated;

grant select, update (username, avatar, country, lang) on public.profiles to authenticated;
grant select, insert, update, delete on public.settings, public.lesson_progress, public.analyses to authenticated;
grant select on public.bot_games, public.puzzle_attempts, public.ratings to authenticated;

create policy "own profile" on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "edit own profile" on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own settings" on public.settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own lesson progress" on public.lesson_progress for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own analyses" on public.analyses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own bot games" on public.bot_games for select to authenticated using (user_id = (select auth.uid()));
create policy "own puzzle attempts" on public.puzzle_attempts for select to authenticated using (user_id = (select auth.uid()));
create policy "own ratings" on public.ratings for select to authenticated using (user_id = (select auth.uid()));
