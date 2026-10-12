// Calls to the database functions for online play (M15 groundwork, migration
// 20261012000000_online_groundwork.sql). Online games themselves come in M16.
import type { SupabaseClient } from "@supabase/supabase-js";

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
