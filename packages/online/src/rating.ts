// The online rating (docs/v0.3-online-design.md, "Ratings"): Glicko, one per speed, the same
// rating maths as bot and puzzle ratings, but against an opponent whose rating is uncertain too.
import { NEW_PLAYER, type Rating, ageRating, updateVs } from "@xq/puzzles";

export interface OnlineRating extends Rating {
  games: number;
  lastPlayed: string | null;
}

export const RATING_FLOOR = 100;

/**
 * Where a player's rating at a speed starts: their bot rating, which itself starts from the
 * skill question at sign-up (800 if skipped or never asked). Uncertain, so it shows "?" until
 * it settles. The database does the same (speed_rating, migration 20261013000000).
 */
export function startingRating(bot: { rating: number } | null): OnlineRating {
  return { rating: Math.round(bot?.rating ?? NEW_PLAYER.rating), rd: NEW_PLAYER.rd, games: 0, lastPlayed: null };
}

const days = (from: string | null, to: Date) => (from ? Math.max(0, (to.getTime() - Date.parse(from)) / 864e5) : 0);

/** Both players' ratings after a rated game; `redScore` is 1 for a Red win, 0.5 a draw, 0 a Black win. */
export function rateOnlineGame(red: OnlineRating, black: OnlineRating, redScore: 0 | 0.5 | 1, at = new Date()): { red: OnlineRating; black: OnlineRating } {
  const r = ageRating(red, days(red.lastPlayed, at));
  const b = ageRating(black, days(black.lastPlayed, at));
  const next = (me: Rating, opp: Rating, score: 0 | 0.5 | 1, games: number): OnlineRating => {
    const u = updateVs(me, opp.rating, opp.rd, score);
    return { rating: Math.max(RATING_FLOOR, u.rating), rd: u.rd, games: games + 1, lastPlayed: at.toISOString() };
  };
  return { red: next(r, b, redScore, red.games), black: next(b, r, (1 - redScore) as 0 | 0.5 | 1, black.games) };
}
