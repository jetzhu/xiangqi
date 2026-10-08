// Rating (Glicko-1), shared by puzzles and bot games. In its own module, without the rules
// engine, so pages that only show or store a rating don't load move generation.

export interface Rating {
  rating: number;
  /** Rating deviation: how unsure we are. */
  rd: number;
}

export const NEW_PLAYER: Rating = { rating: 800, rd: 200 };
const Q = Math.log(10) / 400;
const PUZZLE_RD = 80;
const g = (rd: number) => 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));

/**
 * Update the solver's rating after a puzzle. `score` is 1 for solved, 0 for failed
 * (0.5 is a draw-like result). `maxChange` caps one puzzle's effect, so a new learner's
 * rating doesn't swing wildly.
 */
export function updateRating(r: Rating, puzzleRating: number, score: 0 | 0.5 | 1, maxChange = 80): Rating {
  return updateVs(r, puzzleRating, PUZZLE_RD, score, maxChange);
}

/**
 * One Glicko-1 rating period against a single opponent of rating `opp` and deviation `oppRd`
 * (0 for an opponent of fixed, known strength, such as a bot). The change is capped at
 * `maxChange` either way.
 */
export function updateVs(r: Rating, opp: number, oppRd: number, score: 0 | 0.5 | 1, maxChange = 80): Rating {
  const gj = g(oppRd);
  const e = 1 / (1 + Math.pow(10, (-gj * (r.rating - opp)) / 400));
  const d2 = 1 / (Q * Q * gj * gj * e * (1 - e));
  const denom = 1 / (r.rd * r.rd) + 1 / d2;
  const change = Math.max(-maxChange, Math.min(maxChange, (Q / denom) * gj * (score - e)));
  const rating = r.rating + change;
  const rd = Math.max(50, Math.sqrt(1 / denom));
  return { rating: Math.round(rating), rd: Math.round(rd) };
}

/** RD of a new player; ratings at or above this are shown as provisional. */
export const PROVISIONAL_RD = 110;

/**
 * Uncertainty grows while a player is away (Glicko's c² term), so a returning player's rating
 * moves faster at first. c = 15 per day: about 200 days away takes a settled RD of 50 back to 200.
 */
export function ageRating(r: Rating, daysAway: number, c = 15): Rating {
  if (daysAway <= 0) return r;
  return { rating: r.rating, rd: Math.min(NEW_PLAYER.rd, Math.round(Math.sqrt(r.rd * r.rd + c * c * daysAway))) };
}
