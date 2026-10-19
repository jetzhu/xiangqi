// The `game` server function (a Supabase Edge Function, M16): a browser calls it when its game
// ends, or when the two browsers disagree, and after a rated game with its fair-play analysis
// (M18: fairplay.ts). It empties the report queue into the log, decides
// the result from the log (decide.ts), and for a rated game works out both new ratings and saves
// everything through finish_game (migrations 20261013000000_play_a_friend.sql, and
// 20261016000000_quick_pairing.sql for the sportsmanship labels). The database is
// reached through `Backend`, so this runs the same in the function and in tests.
import type { Color } from "xiangqi-core";
import { type OnlineRating, rateOnlineGame, startingRating } from "../rating.js";
import { NO_RESULT, type OnlineResult } from "../result.js";
import { type AnalysisData, analysesAgree, parseAnalysis } from "../fairplay.js";
import { type Decision, type GameRow, type Labels, type LogRow, decide } from "./decide.js";
import { type Baseline, type FairplayConfig, type SideScore, scoreGame } from "./fairplay.js";

export interface GameRecord extends GameRow {
  id: string;
  red: string | null;
  black: string | null;
  speed: string;
  status: "playing" | "over";
  result: "red" | "black" | "draw" | "none" | null;
  reason: string | null;
  redRatingBefore: number | null;
  redRatingAfter: number | null;
  blackRatingBefore: number | null;
  blackRatingAfter: number | null;
  /** Once over: the moves, and when it ended (ms). */
  moves?: string[];
  endedAt?: number | null;
}

/** What the server keeps of a game's fair-play check (games.fairplay). */
export type FairplayRecord =
  | { status: "one" }
  | { status: "disagree" }
  | { status: "checked"; red: SideScore; black: SideScore; by_moderator?: true };

export interface RatingRow {
  rating: number;
  rd: number;
  games: number;
  last_played: string | null;
}

/** Raised by the database when a rating changed since it was read. */
export class Stale extends Error {}

export interface Backend {
  /** The signed-in player named by the request's Authorization header, or null. */
  user(authorization: string | null): Promise<string | null>;
  /** Moves the queued reports into the game log. */
  drain(): Promise<void>;
  game(id: string): Promise<GameRecord | null>;
  log(id: string): Promise<LogRow[]>;
  rating(user: string, speed: string): Promise<RatingRow | null>;
  /** finish_game; throws Stale if a rating changed. Returns false if the game was already over. */
  /** Stores one browser's analysis and returns both browsers' analyses so far. */
  saveAnalysis(game: string, by: Color, data: AnalysisData): Promise<Partial<Record<Color, AnalysisData>>>;
  /** Honest players of that speed and rating (fairplay_baseline). */
  baseline(speed: string, rating: number): Promise<Baseline>;
  config(): Promise<Partial<FairplayConfig>>;
  /** Whether the user is a moderator (M19): their own analysis settles a game. */
  isModerator(user: string): Promise<boolean>;
  /** Saves the check on the game and updates both players' fair-play standing. */
  saveFairplay(game: string, record: FairplayRecord): Promise<void>;
  finish(args: {
    game: string;
    result: string;
    reason: string;
    moves: string[];
    red: object | null;
    black: object | null;
    expected: { red: number; black: number };
    labels: Labels;
  }): Promise<boolean>;
}

/** How long after a game its analysis is still taken. */
export const ANALYSIS_DAYS = 7;

export interface GameOut {
  status: "playing" | "over";
  /** While playing: why the server can't settle it yet. */
  pending?: string;
  result?: OnlineResult;
  rated?: boolean;
  ratings?: Record<Color, { before: number; after: number } | null>;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-max-age": "86400",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTEMPTS = 5;

const dbResult = (r: OnlineResult) => (r.winner ?? (NO_RESULT.has(r.reason) && r.reason !== "both-away" ? "none" : "draw"));
const asResult = (g: GameRecord): OnlineResult | undefined =>
  g.result && g.reason ? { winner: g.result === "red" || g.result === "black" ? g.result : null, reason: g.reason as OnlineResult["reason"] } : undefined;

function overOut(g: GameRecord): GameOut {
  const pair = (before: number | null, after: number | null) => (before !== null && after !== null ? { before, after } : null);
  const ratings = { red: pair(g.redRatingBefore, g.redRatingAfter), black: pair(g.blackRatingBefore, g.blackRatingAfter) };
  const result = asResult(g);
  return { status: "over", ...(result ? { result } : {}), rated: ratings.red !== null, ratings };
}

/** POST { game: id }: settle the game if its log allows. Only its two players may ask. */
export async function handle(req: Request, db: Backend, now = Date.now()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const user = await db.user(req.headers.get("authorization"));
  if (!user) return json(401, { error: "sign in first" });
  let id: unknown;
  let analysis: unknown;
  try {
    const body = (await req.json()) as { game?: unknown; analysis?: unknown };
    id = body?.game;
    analysis = body?.analysis;
  } catch {
    return json(400, { error: "not JSON" });
  }
  if (typeof id !== "string" || !UUID.test(id)) return json(400, { error: "bad game id" });
  if (analysis !== undefined) return fairplay(db, user, id, analysis, now);

  await db.drain();
  for (let i = 0; i < ATTEMPTS; i++) {
    const g = await db.game(id);
    if (!g || (g.red !== user && g.black !== user)) return json(404, { error: "no such game" });
    if (g.status === "over") return json(200, overOut(g));
    const d = decide(g, await db.log(id), now);
    if (d.kind === "pending") return json(200, { status: "playing", pending: d.why } satisfies GameOut);
    try {
      return json(200, await save(db, g, d));
    } catch (e) {
      if (!(e instanceof Stale)) throw e;
    }
  }
  return json(503, { error: "busy, try again" });
}

/**
 * POST { game, analysis }: one browser's analysis of a finished rated game. Once both are in
 * and agree, both sides are scored; if they disagree, the game waits for a moderator (M19).
 */
async function fairplay(db: Backend, user: string, id: string, raw: unknown, now: number): Promise<Response> {
  const g = await db.game(id);
  const player = !!g && (g.red === user || g.black === user);
  // A moderator's own analysis, from the review page, settles a game whose check is missing or disputed.
  const moderator = !!g && !player && (await db.isModerator(user));
  if (!g || (!player && !moderator)) return json(404, { error: "no such game" });
  if (g.status !== "over" || !g.rated || !g.moves) return json(409, { error: "not a finished rated game" });
  if (player && g.endedAt && now - g.endedAt > ANALYSIS_DAYS * 86_400_000) return json(409, { error: "too late" });
  const data = parseAnalysis(raw, g.moves.length);
  if (!data) return json(400, { error: "bad analysis" });
  if (moderator) {
    const scores = await score(db, g, data);
    await db.saveFairplay(id, { status: "checked", ...scores, by_moderator: true });
    return json(200, { fairplay: "checked" });
  }
  const by: Color = g.red === user ? "red" : "black";
  const both = await db.saveAnalysis(id, by, data);
  if (!both.red || !both.black) {
    await db.saveFairplay(id, { status: "one" });
    return json(200, { fairplay: "one" });
  }
  if (!analysesAgree(both.red, both.black)) {
    await db.saveFairplay(id, { status: "disagree" });
    return json(200, { fairplay: "disagree" });
  }
  await db.saveFairplay(id, { status: "checked", ...(await score(db, g, both.red)) });
  return json(200, { fairplay: "checked" });
}

/** Both sides' scores from an analysis, against baselines for their ratings at the start. */
async function score(db: Backend, g: GameRecord, analysis: AnalysisData) {
  const [config, redBase, blackBase] = await Promise.all([
    db.config(),
    db.baseline(g.speed, g.redRatingBefore ?? 1200),
    db.baseline(g.speed, g.blackRatingBefore ?? 1200),
  ]);
  return scoreGame({ moves: g.moves!, analysis, log: await db.log(g.id), tc: g.tc, baselines: { red: redBase, black: blackBase }, config });
}

async function save(db: Backend, g: GameRecord, d: Extract<Decision, { kind: "over" }>): Promise<GameOut> {
  const row = async (u: string | null): Promise<OnlineRating & { stored: number }> => {
    const r = u ? await db.rating(u, g.speed) : null;
    return r ? { rating: r.rating, rd: r.rd, games: r.games, lastPlayed: r.last_played, stored: r.games } : { ...startingRating(null), stored: 0 };
  };
  const [red, black] = [await row(g.red), await row(g.black)];
  const rated = d.rated && g.red !== null && g.black !== null;
  const score = d.result.winner === "red" ? 1 : d.result.winner === "black" ? 0 : 0.5;
  const after = rated ? rateOnlineGame(red, black, score) : null;
  const out = (before: OnlineRating, a: OnlineRating | undefined) =>
    a ? { before: Math.round(before.rating), rating: a.rating, rd: a.rd, last_played: a.lastPlayed } : null;
  const ok = await db.finish({
    game: g.id,
    result: dbResult(d.result),
    reason: d.result.reason,
    moves: d.moves,
    red: out(red, after?.red),
    black: out(black, after?.black),
    expected: { red: red.stored, black: black.stored },
    labels: d.labels,
  });
  if (!ok) {
    const saved = await db.game(g.id);
    return saved ? overOut(saved) : { status: "over" };
  }
  const pair = (before: OnlineRating, a: OnlineRating | undefined) => (a ? { before: Math.round(before.rating), after: a.rating } : null);
  return { status: "over", result: d.result, rated, ratings: { red: pair(red, after?.red), black: pair(black, after?.black) } };
}

/** The Backend over Supabase's REST API, with the service key (inside the server function only). */
export function restBackend(url: string, serviceKey: string, fetchFn: typeof fetch = fetch): Backend {
  const headers: Record<string, string> = { apikey: serviceKey, ...(serviceKey.startsWith("eyJ") ? { authorization: `Bearer ${serviceKey}` } : {}) };
  const get = async <T>(path: string): Promise<T[]> => {
    const res = await fetchFn(`${url}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`GET ${path.split("?")[0]}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T[];
  };
  const rpc = async (name: string, args: object) => {
    const res = await fetchFn(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(args) });
    const text = await res.text();
    if (res.ok) return text ? (JSON.parse(text) as unknown) : null;
    if (/\bstale\b/.test(text)) throw new Stale();
    throw new Error(`rpc ${name}: ${res.status} ${text}`);
  };
  const q = encodeURIComponent;
  type GameDb = {
    id: string; red: string | null; black: string | null; base: number; inc: number; speed: string; rated: boolean; status: "playing" | "over";
    result: GameRecord["result"]; reason: string | null; started_at: string; ended_at: string | null; moves: string[];
    red_rating_before: number | null; red_rating_after: number | null; black_rating_before: number | null; black_rating_after: number | null;
  };
  return {
    async user(authorization) {
      if (!authorization?.startsWith("Bearer ")) return null;
      const res = await fetchFn(`${url}/auth/v1/user`, { headers: { apikey: serviceKey, authorization } });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new Error(`auth: ${res.status}`);
      return ((await res.json()) as { id?: string }).id ?? null;
    },
    drain: async () => void (await rpc("process_game_reports", {})),
    async game(id) {
      const g = (await get<GameDb>(`games?id=eq.${q(id)}&select=*`))[0];
      if (!g) return null;
      return {
        id: g.id, red: g.red, black: g.black, speed: g.speed, rated: g.rated, status: g.status, result: g.result, reason: g.reason,
        tc: { base: g.base, inc: g.inc }, startedAt: Date.parse(g.started_at), moves: g.moves, endedAt: g.ended_at ? Date.parse(g.ended_at) : null,
        redRatingBefore: g.red_rating_before, redRatingAfter: g.red_rating_after, blackRatingBefore: g.black_rating_before, blackRatingAfter: g.black_rating_after,
      };
    },
    async log(id) {
      const rows = await get<{ by_color: Color; kind: LogRow["kind"]; ply: number | null; report: LogRow["report"]; at: string }>(
        `game_log?game_id=eq.${q(id)}&select=by_color,kind,ply,report,at&order=id`,
      );
      return rows.map((r) => ({ by: r.by_color, kind: r.kind, ply: r.ply, report: r.report, at: Date.parse(r.at) }));
    },
    saveAnalysis: async (game, by, data) =>
      (await rpc("save_analysis", { p_game: game, p_by: by, p_data: data })) as Partial<Record<Color, AnalysisData>>,
    baseline: async (speed, rating) => (await rpc("fairplay_baseline", { p_speed: speed, p_rating: rating })) as Baseline,
    async config() {
      const rows = await get<{ key: string; value: number }>("fairplay_config?select=key,value");
      return Object.fromEntries(rows.map((r) => [r.key, Number(r.value)])) as Partial<FairplayConfig>;
    },
    isModerator: async (user) => (await rpc("is_moderator_user", { p_user: user })) === true,
    saveFairplay: async (game, record) => void (await rpc("save_fairplay", { p_game: game, p_record: record })),
    rating: async (user, speed) => (await get<RatingRow>(`ratings?user_id=eq.${q(user)}&kind=eq.${q(speed)}&select=rating,rd,games,last_played`))[0] ?? null,
    finish: async (a) =>
      (await rpc("finish_game", { p_game: a.game, p_result: a.result, p_reason: a.reason, p_moves: a.moves, p_red: a.red, p_black: a.black, p_expected: a.expected, p_labels: a.labels })) === true,
  };
}
