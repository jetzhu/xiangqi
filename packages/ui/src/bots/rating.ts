// The bot rating: Glicko-1 against bots of fixed strength, kept per player. Rules from the
// v0.2 design (after chess.com's help center): only rated games of at least 4 plies count,
// uncertainty grows with time away, and wins over much weaker bots gain almost nothing.
import { NEW_PLAYER, PROVISIONAL_RD, type Rating, ageRating, updateVs } from "@xq/puzzles";

export interface BotRating extends Rating {
  games: number;
  peak: number | null;
  peakAt: string | null;
  lastPlayed: string | null;
}

export const NEW_BOT_RATING: BotRating = { ...NEW_PLAYER, games: 0, peak: null, peakAt: null, lastPlayed: null };

/** Fewer plies than this and a game is neither saved nor rated (as on chess.com). */
export const MIN_PLIES = 4;
/** A bot this far below the player is "much weaker": a win over it gains a quarter as much. */
export const FARMING_GAP = 400;

export const isProvisional = (r: Rating) => r.rd >= PROVISIONAL_RD;

const days = (from: string | null, to: Date) => (from ? Math.max(0, (to.getTime() - Date.parse(from)) / 864e5) : 0);

/** The rating after a rated game against a bot rated `botRating`; `score` 1 win, 0.5 draw, 0 loss. */
export function rateBotGame(r: BotRating, botRating: number, score: 0 | 0.5 | 1, at = new Date()): BotRating {
  const aged = ageRating(r, days(r.lastPlayed, at));
  let next = updateVs(aged, botRating, 0, score);
  if (score === 1 && botRating <= r.rating - FARMING_GAP) {
    next = { ...next, rating: r.rating + Math.round((next.rating - r.rating) / 4) };
  }
  const games = r.games + 1;
  // The peak counts once the rating has settled, so a lucky first win isn't a record.
  const settled = !isProvisional(next);
  const newPeak = settled && (r.peak === null || next.rating > r.peak);
  return {
    ...next,
    games,
    peak: newPeak ? next.rating : r.peak,
    peakAt: newPeak ? at.toISOString() : r.peakAt,
    lastPlayed: at.toISOString(),
  };
}

export type Unrated = "casual" | "short" | "aborted";

/** Why a finished game did or didn't change the rating, for the result screen. */
export function ratingNote(rated: boolean, plies: number): Unrated | null {
  if (plies < MIN_PLIES) return "short";
  if (!rated) return "casual";
  return null;
}
