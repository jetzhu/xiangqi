// Time controls and the timings that follow from them (docs/v0.3-online-design.md, "Speeds and
// time controls" and "Disconnects and reconnecting").

export type Speed = "lightning" | "blitz" | "rapid";
export const SPEEDS: readonly Speed[] = ["lightning", "blitz", "rapid"];

/** Base time and increment, both in seconds: 5+3 is { base: 300, inc: 3 }. */
export interface TimeControl {
  base: number;
  inc: number;
}

/** The quick-pair tiles of each speed; the first is the main tile. */
export const TILES: Record<Speed, readonly TimeControl[]> = {
  lightning: [{ base: 120, inc: 1 }, { base: 60, inc: 2 }],
  blitz: [{ base: 300, inc: 3 }, { base: 180, inc: 2 }],
  rapid: [{ base: 600, inc: 5 }, { base: 900, inc: 10 }],
};

/** A custom challenge: base 1 to 60 min, increment 0 to 30 s. */
export const isValidTimeControl = (tc: TimeControl) =>
  Number.isInteger(tc.base) && Number.isInteger(tc.inc) && tc.base >= 60 && tc.base <= 3600 && tc.base % 60 === 0 && tc.inc >= 0 && tc.inc <= 30;

/** Estimated length in seconds: base + 40 × increment, as chess.com and lichess count it. */
export const estimatedLength = (tc: TimeControl) => tc.base + 40 * tc.inc;

export function speedOf(tc: TimeControl): Speed {
  const s = estimatedLength(tc);
  return s < 180 ? "lightning" : s < 600 ? "blitz" : "rapid";
}

/** "5+3": minutes + seconds. */
export const formatTimeControl = (tc: TimeControl) => `${tc.base / 60}+${tc.inc}`;

/** Each side must make its first move within this, or the game is aborted. */
export const FIRST_MOVE_MS: Record<Speed, number> = { lightning: 20_000, blitz: 30_000, rapid: 45_000 };

/** Network delay credited per move: the most a move's charged time can differ from what the opponent saw. */
export const LAG_ALLOWANCE_MS: Record<Speed, number> = { lightning: 200, blitz: 300, rapid: 500 };

/** No message from the opponent for this long and they count as away. */
export const AWAY_AFTER_MS = 5_000;
/** How often each browser checks the link is alive. */
export const HEARTBEAT_MS = 1_500;

/**
 * How long an away player has to come back: a tenth of the estimated length, 30 s to 3 min.
 * Halved for a player down 4 or more points of material, 10 s after they closed the tab.
 */
export function reconnectWindowMs(tc: TimeControl, opts: { downMaterial?: boolean; closedTab?: boolean } = {}): number {
  if (opts.closedTab) return 10_000;
  const ms = Math.min(180, Math.max(30, estimatedLength(tc) / 10)) * 1000;
  return opts.downMaterial ? Math.max(15_000, ms / 2) : ms;
}

/** In longer games (a window over 1 min 30 s) the connected player may claim after 1 min… */
export const EARLY_CLAIM_AFTER_MS = 60_000;
export const EARLY_CLAIM_MIN_WINDOW_MS = 90_000;
/** …which leaves the away player a last 30 s. */
export const LAST_CHANCE_MS = 30_000;

/** Rated draws can be offered from 10 moves each; an offerer then waits 10 of their own moves. */
export const DRAW_MIN_PLIES = 20;
export const DRAW_RETRY_MOVES = 10;
/** Rated games shorter than this aren't rated (as for bot games). */
export const MIN_RATED_PLIES = 4;

/** Wait before another takeback request after the nth refusal: 10 s, 40 s, 90 s… */
export const takebackWaitMs = (refusals: number) => 10_000 * refusals * refusals;
