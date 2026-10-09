// The `record` server function (a Supabase Edge Function, M12): checks a finished bot game or
// puzzle attempt sent by the site, works out the new rating, and saves both through the
// database functions in packages/db (migration 20261010000000_records.sql). The database is
// reached through `Backend`, so this runs the same in the function and in tests.
import { NEW_PLAYER, type Puzzle, type Rating, onboardingOf, updateRating } from "@xq/puzzles";
import { type BotRating, NEW_BOT_RATING, rateBotGame } from "../botRating.js";
import { type BotGameClaim, type PuzzleScore, checkBotGame, checkPuzzleAttempt } from "../check.js";

/** A finished bot game, as the site sends it. */
export interface BotGameIn extends BotGameClaim {
  id: string;
  rated: boolean;
  helps: number;
  stars: number | null;
  accuracy: number | null;
  startedAt: string;
  endedAt: string;
}

/** A puzzle attempt, as the site sends it. */
export interface PuzzleAttemptIn {
  /** Named by the browser, so a retried send is saved once. */
  clientId: string;
  puzzleId: string;
  score: PuzzleScore;
  rated: boolean;
  /** The solver's moves (ICCS). */
  moves: string[];
  at: string;
}

export type RecordRequest = { type: "bot-game"; game: BotGameIn } | { type: "puzzle-attempt"; attempt: PuzzleAttemptIn };

export interface BotGameOut {
  rated: boolean;
  ratingBefore: number | null;
  ratingAfter: number | null;
  /** The player's bot rating now. */
  rating: BotRating;
}
export interface PuzzleAttemptOut {
  rated: boolean;
  ratingAfter: number;
  /** The player's puzzle rating now, and how many rated puzzles it counts. */
  rating: Rating & { games: number };
}

export interface RatingRow {
  rating: number;
  rd: number;
  games: number;
  peak: number | null;
  peak_at: string | null;
  last_played: string | null;
}

/** Raised by the database when a rating changed since it was read. */
export class Stale extends Error {}

export interface Backend {
  /** The signed-in player named by the request's Authorization header, or null. */
  user(authorization: string | null): Promise<string | null>;
  rating(user: string, kind: "bot" | "puzzle"): Promise<RatingRow | null>;
  /** Whether the player has tried this puzzle before. */
  tried(user: string, puzzleId: string): Promise<boolean>;
  /** A game already saved under this id (a retried send). */
  game(user: string, id: string): Promise<{ rated: boolean; rating_before: number | null; rating_after: number | null } | null>;
  /** An attempt already saved under this id (a retried send). */
  attempt(user: string, clientId: string): Promise<{ rated: boolean; rating_after: number | null } | null>;
  /** Calls a database function; throws Stale if it raised 'stale'. */
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface Content {
  bots: readonly { id: string; ratingLabel: number }[];
  puzzles: readonly Puzzle[];
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-max-age": "86400",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
/** A request that can never succeed: the site drops it rather than retrying. */
const refuse = (error: string) => json(400, { error });

const SCORE = { win: 1, draw: 0.5, loss: 0 } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Tries before giving up when results keep arriving at the same time. */
const ATTEMPTS = 5;

/** A time from the browser: kept if it's a real time, never later than now. */
function when(s: unknown, now: Date): Date | null {
  if (typeof s !== "string") return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(Math.min(t, now.getTime()));
}

const botRatingOf = (r: RatingRow | null): BotRating =>
  r ? { rating: r.rating, rd: r.rd, games: r.games, peak: r.peak, peakAt: r.peak_at, lastPlayed: r.last_played } : NEW_BOT_RATING;

export async function handle(req: Request, db: Backend, content: Content, now = new Date()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const user = await db.user(req.headers.get("authorization"));
  if (!user) return json(401, { error: "sign in first" });
  let body: RecordRequest;
  try {
    body = (await req.json()) as RecordRequest;
  } catch {
    return refuse("not JSON");
  }
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      if (body?.type === "bot-game") return await botGame(db, user, body.game, content, now);
      if (body?.type === "puzzle-attempt") return await puzzleAttempt(db, user, body.attempt, content, now);
      return refuse("unknown type");
    } catch (e) {
      if (!(e instanceof Stale)) throw e;
    }
  }
  return json(503, { error: "busy, try again" });
}

async function botGame(db: Backend, user: string, g: BotGameIn, content: Content, now: Date): Promise<Response> {
  if (!g || typeof g.id !== "string" || !UUID.test(g.id)) return refuse("bad game id");
  const startedAt = when(g.startedAt, now);
  const endedAt = when(g.endedAt, now);
  if (!startedAt || !endedAt) return refuse("bad times");
  const already = async () => {
    const saved = await db.game(user, g.id);
    const rating = botRatingOf(await db.rating(user, "bot"));
    return json(200, { rated: saved?.rated ?? false, ratingBefore: saved?.rating_before ?? null, ratingAfter: saved?.rating_after ?? null, rating } satisfies BotGameOut);
  };
  if (await db.game(user, g.id)) {
    // Sent again with the accuracy from the post-game review: the database fills it in.
    if (typeof g.accuracy === "number") await db.rpc("record_bot_game", { p_user: user, p_game: { id: g.id, accuracy: g.accuracy }, p_rating: null, p_expected_games: 0 });
    return already();
  }
  const check = checkBotGame(g, content.bots);
  if (!check.ok) return refuse(check.error);

  const before = botRatingOf(await db.rating(user, "bot"));
  const after = g.rated === true ? rateBotGame(before, check.value.botRating, SCORE[g.result], endedAt) : null;
  const isNew = await db.rpc("record_bot_game", {
    p_user: user,
    p_game: {
      id: g.id,
      bot_id: g.botId,
      bot_rating: check.value.botRating,
      player_color: g.playerColor,
      moves: g.moves,
      result: g.result,
      reason: g.reason,
      helps: Number.isInteger(g.helps) ? g.helps : 0,
      stars: Number.isInteger(g.stars) ? g.stars : null,
      accuracy: typeof g.accuracy === "number" ? g.accuracy : null,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
    },
    p_rating: after && {
      rating: after.rating,
      rd: after.rd,
      before: before.rating,
      peak: after.peak,
      peak_at: after.peakAt,
      last_played: after.lastPlayed,
    },
    p_expected_games: before.games,
  });
  if (isNew === false) return already();
  return json(200, { rated: after !== null, ratingBefore: after ? before.rating : null, ratingAfter: after?.rating ?? null, rating: after ?? before } satisfies BotGameOut);
}

async function puzzleAttempt(db: Backend, user: string, a: PuzzleAttemptIn, content: Content, now: Date): Promise<Response> {
  if (!a || typeof a.clientId !== "string" || !UUID.test(a.clientId)) return refuse("bad attempt id");
  const at = when(a.at, now);
  if (!at) return refuse("bad time");
  if (!Array.isArray(a.moves) || a.moves.length > 50 || a.moves.some((m) => typeof m !== "string")) return refuse("bad moves");
  const puzzle = content.puzzles.find((p) => p.id === a.puzzleId);
  if (!puzzle) return refuse(`unknown puzzle "${String(a.puzzleId)}"`);

  const row = await db.rating(user, "puzzle");
  const before: Rating & { games: number } = row ? { rating: row.rating, rd: row.rd, games: row.games } : { ...NEW_PLAYER, games: 0 };
  const saved = await db.attempt(user, a.clientId);
  if (saved) return json(200, { rated: saved.rated, ratingAfter: saved.rating_after ?? before.rating, rating: before } satisfies PuzzleAttemptOut);
  const check = checkPuzzleAttempt(puzzle, a.moves, a.score);
  if (!check.ok) return refuse(check.error);

  // Rated: asked for, not a hinted solve, not a warm-up, and the first try at this puzzle.
  const warmUp = onboardingOf(content.puzzles).some((p) => p.id === puzzle.id);
  const rated = a.rated === true && a.score !== 0.5 && !warmUp && !(await db.tried(user, puzzle.id));
  const after = rated ? updateRating(before, puzzle.rating, a.score) : null;
  await db.rpc("record_puzzle_attempt", {
    p_user: user,
    p_attempt: { client_id: a.clientId, puzzle_id: puzzle.id, score: a.score, moves: a.moves, at: at.toISOString(), rating_after: before.rating },
    p_rating: after && { rating: after.rating, rd: after.rd, last_played: at.toISOString() },
    p_expected_games: before.games,
  });
  const rating = after ? { ...after, games: before.games + 1 } : before;
  return json(200, { rated, ratingAfter: rating.rating, rating } satisfies PuzzleAttemptOut);
}

/** The Backend over Supabase's REST API, with the service key (inside the server function only). */
export function restBackend(url: string, serviceKey: string, fetchFn: typeof fetch = fetch): Backend {
  // A legacy service-role key is a JWT and also goes in Authorization; a new secret key only in apikey.
  const headers: Record<string, string> = { apikey: serviceKey, ...(serviceKey.startsWith("eyJ") ? { authorization: `Bearer ${serviceKey}` } : {}) };
  const get = async <T>(path: string): Promise<T[]> => {
    const res = await fetchFn(`${url}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`GET ${path.split("?")[0]}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T[];
  };
  const q = encodeURIComponent;
  return {
    async user(authorization) {
      if (!authorization?.startsWith("Bearer ")) return null;
      const res = await fetchFn(`${url}/auth/v1/user`, { headers: { apikey: serviceKey, authorization } });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new Error(`auth: ${res.status}`);
      return ((await res.json()) as { id?: string }).id ?? null;
    },
    rating: async (user, kind) => (await get<RatingRow>(`ratings?user_id=eq.${q(user)}&kind=eq.${kind}&select=rating,rd,games,peak,peak_at,last_played`))[0] ?? null,
    tried: async (user, puzzleId) => (await get(`puzzle_attempts?user_id=eq.${q(user)}&puzzle_id=eq.${q(puzzleId)}&select=id&limit=1`)).length > 0,
    game: async (user, id) =>
      (await get<{ rated: boolean; rating_before: number | null; rating_after: number | null }>(`bot_games?user_id=eq.${q(user)}&id=eq.${q(id)}&select=rated,rating_before,rating_after`))[0] ?? null,
    attempt: async (user, clientId) =>
      (await get<{ rated: boolean; rating_after: number | null }>(`puzzle_attempts?user_id=eq.${q(user)}&client_id=eq.${q(clientId)}&select=rated,rating_after`))[0] ?? null,
    async rpc(name, args) {
      const res = await fetchFn(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(args) });
      const text = await res.text();
      if (res.ok) return text ? JSON.parse(text) : null;
      if (/\bstale\b/.test(text)) throw new Stale();
      throw new Error(`rpc ${name}: ${res.status} ${text}`);
    },
  };
}
