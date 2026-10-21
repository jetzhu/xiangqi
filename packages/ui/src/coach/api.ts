// Coaching (M23, migration 20261026000000_coaching.sql): the database calls behind the coach,
// guardian and moderation pages. Errors carry the database's hint, which the pages explain.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OnlineGameRow } from "../online/api.js";

export class CoachError extends Error {
  constructor(
    message: string,
    readonly hint: string | null,
  ) {
    super(message);
  }
}

async function rpc<T>(sb: SupabaseClient, fn: string, args?: object): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new CoachError(error.message, error.hint || null);
  return data as T;
}

export type LinkStatus = "guardian" | "coach" | "review" | "active" | "ended" | "declined";
export interface MyCoaching {
  needs_guardian: boolean;
  /** Why this player can't coach yet, or null. */
  coach_problem: "age" | "email" | "new" | "barred" | null;
  as_student: { id: number; coach: string; kind: "coach" | "family"; status: LinkStatus; created_at: string; ended_at: string | null; ended_by: string | null }[];
  visits: { coach: string; game: string | null; at: string }[];
  requests: { id: number; student: string; kind: "coach" | "family"; status: "coach" | "review"; under16: boolean; created_at: string }[];
  students: { id: number; student: string; kind: "coach" | "family"; since: string; ratings: Record<string, number>; games_30d: number }[];
  codes: { code: string; expires_at: string }[];
}
export type CoachGameRow = OnlineGameRow & { opponent_under16: boolean };

export const myCoaching = (sb: SupabaseClient) => rpc<MyCoaching | null>(sb, "my_coaching");
export const requestCoach = (sb: SupabaseClient, r: { coach: string | null; code: string | null; family: boolean; guardianEmail: string | null }) =>
  rpc<{ id: number; status: LinkStatus; coach: string }>(sb, "request_coach", { p_coach: r.coach, p_code: r.code, p_family: r.family, p_guardian_email: r.guardianEmail });
export const createCoachCode = (sb: SupabaseClient) => rpc<{ code: string; expires_at: string }>(sb, "create_coach_code");
export const coachAnswer = (sb: SupabaseClient, link: number, accept: boolean) => rpc<string>(sb, "coach_answer", { p_link: link, p_accept: accept });
export const endCoachLink = (sb: SupabaseClient, link: number) => rpc<null>(sb, "end_coach_link", { p_link: link });
export const reportCoach = (sb: SupabaseClient, link: number, note: string) => rpc<null>(sb, "report_coach", { p_link: link, p_note: note });
export const coachStudentGames = (sb: SupabaseClient, student: string, before: string | null) =>
  rpc<CoachGameRow[]>(sb, "coach_student_games", { p_student: student, p_before: before, p_limit: 20 });

export interface GuardianView {
  student: string;
  coach: string;
  kind: "coach" | "family";
  status: LinkStatus;
  created_at: string;
  line_lowered: boolean;
  visits: number;
}
export const guardianView = (sb: SupabaseClient, token: string) => rpc<GuardianView | null>(sb, "guardian_view", { p_token: token });
export const guardianAnswer = (sb: SupabaseClient, token: string, confirm: boolean, lower: boolean | null) =>
  rpc<null>(sb, "guardian_answer", { p_token: token, p_confirm: confirm, p_lower: lower });
export const guardianEnd = (sb: SupabaseClient, token: string) => rpc<null>(sb, "guardian_end", { p_token: token });

export interface ModCoaching {
  reports: { id: number; coach: string; reporter: string | null; note: string; at: string; link: number | null; link_status: LinkStatus | null; barred: boolean }[];
  review: { id: number; coach: string; student: string; created_at: string; students_under16: number }[];
}
export interface ModCoachLinks {
  coach: string;
  barred: boolean;
  problem: string | null;
  links: { id: number; student: string; kind: string; status: LinkStatus; under16: boolean; created_at: string; ended_by: string | null; visits: number }[];
}
export const modCoaching = (sb: SupabaseClient) => rpc<ModCoaching>(sb, "mod_coaching");
export const modCoachLinks = (sb: SupabaseClient, username: string) => rpc<ModCoachLinks | null>(sb, "mod_coach_links", { p_username: username });
export const modLink = (sb: SupabaseClient, link: number, action: "approve" | "end", note: string) => rpc<null>(sb, "mod_link", { p_link: link, p_action: action, p_note: note });
export const modBarCoach = (sb: SupabaseClient, username: string, barred: boolean, note: string) =>
  rpc<null>(sb, "mod_bar_coach", { p_username: username, p_barred: barred, p_note: note });
export const modCloseCoachReport = (sb: SupabaseClient, id: number, note: string) => rpc<null>(sb, "mod_close_coach_report", { p_id: id, p_note: note });
