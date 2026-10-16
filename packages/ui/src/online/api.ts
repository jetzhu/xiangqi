// Calls to the database functions for online play (migrations 20261012000000_online_groundwork.sql
// for M15, 20261012120000_birth_month.sql, 20261013000000_play_a_friend.sql for M16, and
// 20261016000000_quick_pairing.sql for M17) and to the `game` server function.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OnlineResult, Report } from "@xq/online";

export type Speed = "lightning" | "blitz" | "rapid";
export const SPEEDS: Speed[] = ["lightning", "blitz", "rapid"];

export interface PublicProfile {
  username: string;
  /** Under 16, or no birth month given: only the username and ratings are shown. */
  minimal: boolean;
  avatar: string | null;
  country: string | null;
  member_since: string | null;
  ratings: Partial<Record<Speed, { rating: number; rd: number; games: number }>>;
  /** Fair-play record: completion rate from M17, checked games from M18, violations from M19. */
  completion: number | null;
  checked_games: number;
  violation: { at: string } | null;
  /** The signed-in viewer has blocked this player. */
  blocked: boolean;
  /** The viewer is this player. */
  me: boolean;
}

export interface Eligibility {
  verified: boolean;
  /** The birth month is given. */
  age_answered: boolean;
  /** Under 16, or not said. */
  under16: boolean;
  /** The birth month that counts now, YYYY-MM, and a change to an earlier one that waits a week. */
  born: string | null;
  born_next: string | null;
  born_next_at: string | null;
  /** The one change to an earlier month allowed while under 16 is used. */
  earlier_used: boolean;
  /** The day an under-16 player turns 16 here (YYYY-MM-DD). */
  sixteen_on: string | null;
  /** The player's level (their bot rating) and the bot rating a qualifying win needs. */
  level: number;
  target: number;
  clean_win: boolean;
  long_games: number;
  /** Ready for casual friend games: a verified email and the birth month. */
  casual_ok: boolean;
  /** Ready for rated games and quick pairing: also the bot games (D9). */
  eligible: boolean;
}

/** Bot games of at least this many moves each count towards online play. */
export const LONG_GAME_MOVES = 10;
export const LONG_GAMES_NEEDED = 3;

async function rpc<T>(sb: SupabaseClient, fn: string, args?: object): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const publicProfile = (sb: SupabaseClient, username: string) => rpc<PublicProfile | null>(sb, "public_profile", { p_username: username });
export const onlineEligibility = (sb: SupabaseClient) => rpc<Eligibility | null>(sb, "online_eligibility");
export const setBirthMonth = (sb: SupabaseClient, year: number, month: number) => rpc<null>(sb, "set_birth_month", { p_year: year, p_month: month });
export const setBlocked = (sb: SupabaseClient, username: string, blocked: boolean) => rpc<boolean>(sb, "set_blocked", { p_username: username, p_blocked: blocked });
export const myBlocks = (sb: SupabaseClient) => rpc<{ username: string; blocked_at: string }[]>(sb, "my_blocks");

// Play a friend (M16) ---------------------------------------------------------------------

export type ChallengeColor = "red" | "black" | "random";

export interface ChallengeInfo {
  code: string;
  from: string;
  /** The challenge is the viewer's own. */
  mine: boolean;
  /** The challenger's rating at this speed, if they have one. */
  rating: number | null;
  base: number;
  inc: number;
  color: ChallengeColor;
  rated: boolean;
  expired: boolean;
  /** The game, once accepted: shown to its two players only. */
  game: string | null;
  taken: boolean;
}

export interface GamePlayer {
  username: string | null;
  avatar: string | null;
  rating: number | null;
  rd: number | null;
}

export interface GameInfo {
  id: string;
  me: "red" | "black";
  red: GamePlayer;
  black: GamePlayer;
  base: number;
  inc: number;
  speed: Speed;
  rated: boolean;
  relay: boolean;
  status: "playing" | "over";
  result: "red" | "black" | "draw" | "none" | null;
  reason: string | null;
  moves: string[];
  red_rating_before: number | null;
  red_rating_after: number | null;
  black_rating_before: number | null;
  black_rating_after: number | null;
}

/** What the `game` server function says about a game. */
export interface GameVerdict {
  status: "playing" | "over";
  pending?: string;
  result?: OnlineResult;
  rated?: boolean;
  ratings?: Record<"red" | "black", { before: number; after: number } | null>;
}

export const createChallenge = (sb: SupabaseClient, c: { base: number; inc: number; color: ChallengeColor; rated: boolean; relay: boolean }) =>
  rpc<string>(sb, "create_challenge", { p_base: c.base, p_inc: c.inc, p_color: c.color, p_rated: c.rated, p_relay: c.relay });
export const challengeInfo = (sb: SupabaseClient, code: string) => rpc<ChallengeInfo | null>(sb, "challenge_info", { p_code: code });
export const cancelChallenge = (sb: SupabaseClient, code: string) => rpc<null>(sb, "cancel_challenge", { p_code: code });
/** `casual`: accept a rated challenge as a casual game (for a player not yet ready for rated games). */
export const acceptChallenge = (sb: SupabaseClient, code: string, relay: boolean, casual = false) => rpc<string>(sb, "accept_challenge", { p_code: code, p_relay: relay, p_casual: casual });
export const gameInfo = (sb: SupabaseClient, id: string) => rpc<GameInfo | null>(sb, "game_info", { p_game: id });
export const reportGame = (sb: SupabaseClient, id: string, report: Report) => rpc<null>(sb, "report_game", { p_game: id, p_report: report });

/** Asks the server to settle a game from its log (at the end, or when the browsers disagree). */
export async function settleGame(sb: SupabaseClient, id: string): Promise<GameVerdict> {
  const { data, error } = await sb.functions.invoke<GameVerdict>("game", { body: { game: id } });
  if (error) throw new Error(error.message);
  return data!;
}

// Quick pairing and sportsmanship (M17, migration 20261016000000_quick_pairing.sql) -----------

/** The opponent filters from Settings → Online play, as seek() takes them. */
export interface SeekFilters {
  range: number | null;
  established: boolean;
  account_age: number;
  completion: number;
}

export interface Seeking {
  status: "searching";
  /** How far from the player's rating an opponent may be now; null: no limit. */
  window: number | null;
  anyone: boolean;
  /** Seconds since the search started. */
  waited: number;
  /** The nearest players seeking on the same tile but outside the window, for "Play anyway". */
  nearest: { username: string; rating: number; diff: number; waited: number; invited: boolean }[];
  /** Someone outside the window wants to play: their rating and the gap, open for `expires_in` s. */
  invite: { id: number; rating: number; diff: number; expires_in: number } | null;
  /** Players seeking on each tile, keyed "base+inc" in seconds. */
  counts: Record<string, number>;
}
export type MatchState = { status: "idle" } | { status: "matched"; game: string } | Seeking;

export interface Sportsmanship {
  /** Per cent of games in the last 90 days not abandoned, stalled or aborted; null under 5 games. */
  completion: number | null;
  last30: { games: number; abandoned: number; stalled: number; aborted: number; slow_start: number };
  /** A warning to acknowledge before seeking again. */
  warning: boolean;
  /** A pairing wait: no seeking before this. */
  wait_until: string | null;
  /** Matched only with other players under a penalty. */
  pool: boolean;
}

export const seek = (sb: SupabaseClient, tc: { base: number; inc: number }, filters: SeekFilters, relay: boolean) =>
  rpc<null>(sb, "seek", { p_base: tc.base, p_inc: tc.inc, p_filters: filters, p_relay: relay });
export const findMatch = (sb: SupabaseClient) => rpc<MatchState>(sb, "find_match");
export const inviteSeeker = (sb: SupabaseClient, username: string) => rpc<boolean>(sb, "invite_seeker", { p_username: username });
export const answerInvite = (sb: SupabaseClient, id: number, accept: boolean) => rpc<string | null>(sb, "answer_invite", { p_id: id, p_accept: accept });
export const widenSeek = (sb: SupabaseClient) => rpc<null>(sb, "widen_seek");
export const cancelSeek = (sb: SupabaseClient) => rpc<null>(sb, "cancel_seek");
export const seekCounts = (sb: SupabaseClient) => rpc<Record<string, number>>(sb, "seek_counts");
export const mySportsmanship = (sb: SupabaseClient) => rpc<Sportsmanship>(sb, "my_sportsmanship");
export const acknowledgeSportsmanship = (sb: SupabaseClient) => rpc<null>(sb, "acknowledge_sportsmanship");
