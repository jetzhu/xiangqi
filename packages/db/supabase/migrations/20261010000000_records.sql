-- M12: server-checked records. The record-bot-game and record-puzzle-attempt server functions
-- check a result (packages/records), work out the new rating, then call one of the functions
-- below, which save the record and the rating together. The rating is only saved if no other
-- result came in since the server function read it; otherwise it raises 'stale' and the server
-- function starts again. Sending the same record twice saves it once.

alter table public.bot_games add column helps int not null default 0;

-- The browser names each attempt, so a retried send isn't counted twice.
alter table public.puzzle_attempts
  add column client_id uuid,
  add column moves text[] not null default '{}';
create unique index puzzle_attempts_client_idx on public.puzzle_attempts (user_id, client_id);

-- Uncertainty grows with time away from the last rated game or puzzle.
alter table public.ratings add column last_played timestamptz;

/** Saves `p_rating` as the player's `p_kind` rating if it still has `p_expected_games` games. */
create function public.save_rating(p_user uuid, p_kind text, p_rating jsonb, p_expected_games int)
returns void language plpgsql set search_path = '' as $$
declare
  games int;
begin
  select r.games into games from public.ratings r where r.user_id = p_user and r.kind = p_kind for update;
  if coalesce(games, 0) <> p_expected_games then
    raise exception 'stale' using errcode = '40001';
  end if;
  insert into public.ratings (user_id, kind, rating, rd, games, peak, peak_at, last_played, updated_at)
  values (p_user, p_kind, (p_rating->>'rating')::real, (p_rating->>'rd')::real, p_expected_games + 1,
          (p_rating->>'peak')::real, (p_rating->>'peak_at')::timestamptz, (p_rating->>'last_played')::timestamptz, now())
  on conflict (user_id, kind) do update set
    rating = excluded.rating, rd = excluded.rd, games = excluded.games, peak = excluded.peak,
    peak_at = excluded.peak_at, last_played = excluded.last_played, updated_at = now();
end $$;

/**
 * Saves a checked bot game, and for a rated one the new bot rating. Returns false if the game
 * was already saved (a retry), true if it is new.
 */
create function public.record_bot_game(p_user uuid, p_game jsonb, p_rating jsonb, p_expected_games int)
returns boolean language plpgsql set search_path = '' as $$
declare
  rated boolean := coalesce(jsonb_typeof(p_rating) = 'object', false);
begin
  if exists (select 1 from public.bot_games g where g.id = (p_game->>'id')::uuid) then
    return false;
  end if;
  insert into public.bot_games (id, user_id, bot_id, bot_rating, player_color, moves, result, reason, rated,
                                rating_before, rating_after, stars, helps, accuracy, started_at, ended_at)
  values ((p_game->>'id')::uuid, p_user, p_game->>'bot_id', (p_game->>'bot_rating')::int, p_game->>'player_color',
          array(select jsonb_array_elements_text(p_game->'moves')), p_game->>'result', p_game->>'reason',
          rated, (p_rating->>'before')::int, (p_rating->>'rating')::int, (p_game->>'stars')::int,
          coalesce((p_game->>'helps')::int, 0), (p_game->>'accuracy')::real,
          (p_game->>'started_at')::timestamptz, (p_game->>'ended_at')::timestamptz);
  if rated then
    perform public.save_rating(p_user, 'bot', p_rating, p_expected_games);
  end if;
  return true;
end $$;

/**
 * Saves a checked puzzle attempt, and for a rated one the new puzzle rating. A rated attempt
 * at a puzzle the player has already tried is 'stale': the server function looks again and
 * records it unrated. Returns false if the attempt was already saved.
 */
create function public.record_puzzle_attempt(p_user uuid, p_attempt jsonb, p_rating jsonb, p_expected_games int)
returns boolean language plpgsql set search_path = '' as $$
declare
  rated boolean := coalesce(jsonb_typeof(p_rating) = 'object', false);
begin
  if exists (select 1 from public.puzzle_attempts a
             where a.user_id = p_user and a.client_id = (p_attempt->>'client_id')::uuid) then
    return false;
  end if;
  if rated and exists (select 1 from public.puzzle_attempts a
                                      where a.user_id = p_user and a.puzzle_id = p_attempt->>'puzzle_id') then
    raise exception 'stale' using errcode = '40001';
  end if;
  insert into public.puzzle_attempts (user_id, client_id, puzzle_id, score, rated, rating_after, moves, at)
  values (p_user, (p_attempt->>'client_id')::uuid, p_attempt->>'puzzle_id', (p_attempt->>'score')::real,
          rated, coalesce((p_rating->>'rating')::int, (p_attempt->>'rating_after')::int),
          array(select jsonb_array_elements_text(coalesce(p_attempt->'moves', '[]'))), (p_attempt->>'at')::timestamptz);
  if rated then
    perform public.save_rating(p_user, 'puzzle', p_rating, p_expected_games);
  end if;
  return true;
end $$;

-- Only the server functions (with the service key) may call these.
revoke execute on function public.save_rating(uuid, text, jsonb, int) from public, anon, authenticated;
revoke execute on function public.record_bot_game(uuid, jsonb, jsonb, int) from public, anon, authenticated;
revoke execute on function public.record_puzzle_attempt(uuid, jsonb, jsonb, int) from public, anon, authenticated;
grant execute on function public.save_rating(uuid, text, jsonb, int) to service_role;
grant execute on function public.record_bot_game(uuid, jsonb, jsonb, int) to service_role;
grant execute on function public.record_puzzle_attempt(uuid, jsonb, jsonb, int) to service_role;

/**
 * The answer to "How well do you know Xiangqi?": the starting bot and puzzle rating, for a
 * player with no rated games or puzzles yet. Returns false if it's too late to set it.
 */
create function public.set_starting_rating(p_rating int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null or p_rating not in (400, 800, 1200, 1600) then
    raise exception 'bad starting rating' using errcode = '22023';
  end if;
  if exists (select 1 from public.ratings r where r.user_id = me) then
    return false;
  end if;
  insert into public.ratings (user_id, kind, rating, rd, games)
  values (me, 'bot', p_rating, 200, 0), (me, 'puzzle', p_rating, 200, 0); -- uncertainty as for a new player (NEW_PLAYER)
  return true;
end $$;
revoke execute on function public.set_starting_rating(int) from public, anon;
grant execute on function public.set_starting_rating(int) to authenticated;
