// The account's data in Supabase, for the sync engine (store/sync.ts). Row-level security
// limits every query to the signed-in player's own rows.
import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import type { SavedAnalysis } from "../analysis/storage.js";
import type { BotRating } from "../bots/rating.js";
import type { LessonStatus, Progress } from "../learn/progress.js";
import type { PuzzleRecord } from "../puzzles/store.js";
import type { GameRecord } from "../store/index.js";
import { type PlayerState, Rejected, type Remote, type StateKey, type SyncedSettings } from "../store/sync.js";

interface GameRow {
  id: string;
  bot_id: string;
  bot_rating: number;
  player_color: "red" | "black";
  moves: string[];
  result: "win" | "loss" | "draw";
  reason: string | null;
  rated: boolean;
  rating_before: number | null;
  rating_after: number | null;
  stars: number | null;
  helps: number;
  accuracy: number | null;
  started_at: string;
  ended_at: string | null;
}
interface AttemptRow {
  client_id: string | null;
  puzzle_id: string;
  score: number;
  rated: boolean;
  rating_after: number | null;
  at: string;
}
interface RatingRow {
  kind: "bot" | "puzzle" | "online";
  rating: number;
  rd: number;
  games: number;
  peak: number | null;
  peak_at: string | null;
  last_played: string | null;
}

const gameOf = (r: GameRow): GameRecord => ({
  id: r.id,
  botId: r.bot_id,
  botRating: r.bot_rating,
  playerColor: r.player_color,
  moves: r.moves,
  result: r.result,
  reason: r.reason,
  rated: r.rated,
  ratingBefore: r.rating_before,
  ratingAfter: r.rating_after,
  helps: r.helps,
  stars: r.stars,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  accuracy: r.accuracy,
});
const attemptOf = (r: AttemptRow, fallback: number): PuzzleRecord => ({
  id: r.puzzle_id,
  score: (r.score === 1 || r.score === 0.5 ? r.score : 0) as PuzzleRecord["score"],
  ratingAfter: r.rating_after ?? fallback,
  at: r.at,
  rated: r.rated,
  ...(r.client_id ? { clientId: r.client_id } : {}),
});

/** The newest games and attempts shown (history and stats); older ones stay on the server. */
const MAX_GAMES = 500;
const MAX_ATTEMPTS = 3000;

interface Result<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
  status: number;
}

/** Network trouble and expired sessions are retried; anything else the server refused is not. */
function check<T>({ data, error, status }: Result<T>): T {
  if (!error) return data as T;
  if (status >= 400 && status < 500 && ![401, 408, 429].includes(status)) throw new Rejected(error.message);
  throw new Error(error.message);
}

export function supabaseRemote(sb: SupabaseClient, userId: string): Remote {
  return {
    async pull() {
      const [lessons, state, analyses, settings, games, attempts, ratings, deletion] = await Promise.all([
        sb.from("lesson_progress").select("lesson_id, status"),
        sb.from("player_state").select("key, value"),
        sb.from("analyses").select("id, title, data, updated_at"),
        sb.from("settings").select("data").maybeSingle(),
        sb
          .from("bot_games")
          .select("id, bot_id, bot_rating, player_color, moves, result, reason, rated, rating_before, rating_after, stars, helps, accuracy, started_at, ended_at")
          .order("started_at", { ascending: false })
          .limit(MAX_GAMES),
        sb.from("puzzle_attempts").select("client_id, puzzle_id, score, rated, rating_after, at").order("at", { ascending: false }).limit(MAX_ATTEMPTS),
        sb.from("ratings").select("kind, rating, rd, games, peak, peak_at, last_played"),
        sb.from("account_deletions").select("user_id"),
      ]);
      const rows = <T>(r: Result<T[]>) => check(r) ?? [];
      const rated = rows(ratings as Result<RatingRow[]>);
      const bot = rated.find((x) => x.kind === "bot");
      const puzzle = rated.find((x) => x.kind === "puzzle");
      const botRating: BotRating | null = bot
        ? { rating: bot.rating, rd: bot.rd, games: bot.games, peak: bot.peak, peakAt: bot.peak_at, lastPlayed: bot.last_played }
        : null;
      const puzzleRating = puzzle ? { rating: puzzle.rating, rd: puzzle.rd } : null;
      return {
        lessons: Object.fromEntries(rows(lessons as Result<{ lesson_id: string; status: LessonStatus }[]>).map((r) => [r.lesson_id, r.status])),
        state: Object.fromEntries(rows(state as Result<{ key: StateKey; value: unknown }[]>).map((r) => [r.key, r.value])) as Partial<PlayerState>,
        analyses: rows(analyses as Result<{ id: string; title: string; data: { pgn?: string }; updated_at: string }[]>).map((r) => ({
          id: r.id,
          title: r.title,
          pgn: r.data.pgn ?? "",
          savedAt: r.updated_at,
        })),
        settings: (check(settings as Result<{ data: SyncedSettings }>) ?? null)?.data ?? null,
        records: {
          games: rows(games as Result<GameRow[]>).map(gameOf),
          puzzles: rows(attempts as Result<AttemptRow[]>)
            .reverse()
            .map((a) => attemptOf(a, puzzleRating?.rating ?? 800)),
          botRating,
          puzzleRating,
        },
        deletionPending: rows(deletion as Result<unknown[]>).length > 0,
      };
    },

    async lessons(p: Progress) {
      if (Object.keys(p).length === 0) {
        // A reset from Settings: statuses never go down on the server, so the rows go.
        check(await sb.from("lesson_progress").delete().eq("user_id", userId));
        return {};
      }
      const now = new Date().toISOString();
      const sent = Object.entries(p).map(([lesson_id, status]) => ({ user_id: userId, lesson_id, status, updated_at: now }));
      const back = check(await sb.from("lesson_progress").upsert(sent, { onConflict: "user_id,lesson_id" }).select("lesson_id, status")) as
        | { lesson_id: string; status: LessonStatus }[]
        | null;
      return Object.fromEntries((back ?? []).map((r) => [r.lesson_id, r.status]));
    },

    async state<K extends StateKey>(key: K, value: PlayerState[K]) {
      const back = check(
        await sb.from("player_state").upsert({ user_id: userId, key, value }, { onConflict: "user_id,key" }).select("value").single(),
      ) as { value: PlayerState[K] };
      return back.value;
    },

    async saveAnalysis(a: SavedAnalysis) {
      check(await sb.from("analyses").upsert({ id: a.id, user_id: userId, title: a.title.slice(0, 200), data: { pgn: a.pgn }, updated_at: a.savedAt }));
    },

    async removeAnalysis(id: string) {
      check(await sb.from("analyses").delete().eq("id", id));
    },

    async settings(data: SyncedSettings) {
      check(await sb.from("settings").upsert({ user_id: userId, data, updated_at: new Date().toISOString() }));
    },

    recordGame: (g) => record(sb, { type: "bot-game", game: g }),
    recordPuzzle: (a) => record(sb, { type: "puzzle-attempt", attempt: a }),

    async startingRating(rating: number) {
      return check(await sb.rpc("set_starting_rating", { p_rating: rating })) as boolean;
    },
  };
}

/** Calls the `record` server function (packages/records/src/server). A 400 is refused for good. */
async function record<T>(sb: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.functions.invoke<T>("record", { body });
  if (!error) return data as T;
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    const why = await res.json().then((b: { error?: string }) => b.error ?? "", () => "");
    if (res.status === 400) throw new Rejected(why || "refused");
    throw new Error(`record: ${res.status} ${why}`);
  }
  throw error;
}
