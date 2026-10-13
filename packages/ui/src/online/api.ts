// Calls to the database functions for online play (migrations 20261012000000_online_groundwork.sql
// for M15 and 20261013000000_play_a_friend.sql for M16) and to the `game` server function.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OnlineResult, Report } from "@xq/online";

export type Speed = "lightning" | "blitz" | "rapid";
export const SPEEDS: Speed[] = ["lightning", "blitz", "rapid"];

export interface PublicProfile {
  username: string;
  /** Under 16, or not said: only the username and ratings are shown. */
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
  age_answered: boolean;
  under16: boolean | null;
  /** The player's level (their bot rating) and the bot rating a qualifying win needs. */
  level: number;
  target: number;
  clean_win: boolean;
  long_games: number;
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
export const setAgeGroup = (sb: SupabaseClient, sixteenOrOlder: boolean) => rpc<null>(sb, "set_age_group", { p_sixteen_or_older: sixteenOrOlder });
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
export const acceptChallenge = (sb: SupabaseClient, code: string, relay: boolean) => rpc<string>(sb, "accept_challenge", { p_code: code, p_relay: relay });
export const gameInfo = (sb: SupabaseClient, id: string) => rpc<GameInfo | null>(sb, "game_info", { p_game: id });
export const reportGame = (sb: SupabaseClient, id: string, report: Report) => rpc<null>(sb, "report_game", { p_game: id, p_report: report });

/** Asks the server to settle a game from its log (at the end, or when the browsers disagree). */
export async function settleGame(sb: SupabaseClient, id: string): Promise<GameVerdict> {
  const { data, error } = await sb.functions.invoke<GameVerdict>("game", { body: { game: id } });
  if (error) throw new Error(error.message);
  return data!;
}
