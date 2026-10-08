// The account's data in Supabase, for the sync engine (store/sync.ts). Row-level security
// limits every query to the signed-in player's own rows.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SavedAnalysis } from "../analysis/storage.js";
import type { LessonStatus, Progress } from "../learn/progress.js";
import { type PlayerState, Rejected, type Remote, type StateKey, type SyncedSettings } from "../store/sync.js";

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
      const [lessons, state, analyses, settings] = await Promise.all([
        sb.from("lesson_progress").select("lesson_id, status"),
        sb.from("player_state").select("key, value"),
        sb.from("analyses").select("id, title, data, updated_at"),
        sb.from("settings").select("data").maybeSingle(),
      ]);
      const rows = <T>(r: Result<T[]>) => check(r) ?? [];
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
  };
}
