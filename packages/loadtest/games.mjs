// Games under load (M20): G games between synthetic players, played at a real pace. Both
// browsers report every move to the queue, as the game page does; then every game ends at
// once (a resignation), both players ask the `game` function to settle it, and both send a
// fair-play analysis. Reports report_game and game-function latency, how far the queue worker
// fell behind, and the storage each game takes.
//
//   node packages/loadtest/games.mjs --games 100 --plies 60 --seconds-per-ply 3
import { rolldown } from "rolldown";
import { arg, gameFn, rpc, signInAll, sleep, sql, summary } from "./lib.mjs";

const G = arg("games", 50);
const PLIES = arg("plies", 60);
const PER_PLY = arg("seconds-per-ply", 3) * 1000;

// Random legal games from the site's own rules (xiangqi-core), bundled on the fly.
const build = await rolldown({ input: new URL("../xiangqi-core/src/index.ts", import.meta.url).pathname, resolve: { extensionAlias: { ".js": [".ts", ".js"] } }, logLevel: "silent" });
const { output } = await build.generate({ format: "esm" });
const { Game, toIccs } = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);
function randomGame(plies) {
  for (;;) {
    const g = new Game();
    const moves = [];
    while (moves.length < plies && !g.result) {
      const legal = g.legalMoves();
      const m = toIccs(legal[Math.floor(Math.random() * legal.length)]);
      g.move(m);
      moves.push(m);
    }
    if (!g.result) return moves;
  }
}

console.log(`Signing in ${2 * G} players…`);
const tokens = await signInAll(2 * G, 0);
const ids = await sql(`select user_id from public.profiles where username like 'lt-%' order by username limit ${2 * G}`);
const sizeBefore = await sql(`select pg_total_relation_size('public.game_log') + pg_total_relation_size('public.games') + pg_total_relation_size('public.game_analysis') as bytes`);
const games = await sql(`insert into public.games (red, black, base, inc, speed, rated, relay)
  select a.user_id, b.user_id, 300, 3, 'blitz', true, false
  from (select user_id, row_number() over () as n from unnest(array[${ids.filter((_, i) => i % 2 === 0).map((r) => `'${r.user_id}'::uuid`).join(",")}]) user_id) a
  join (select user_id, row_number() over () as n from unnest(array[${ids.filter((_, i) => i % 2 === 1).map((r) => `'${r.user_id}'::uuid`).join(",")}]) user_id) b using (n)
  returning id`);
console.log(`${games.length} games of ${PLIES} plies, a ply every ${PER_PLY / 1000} s: about ${((2 * G) / (PER_PLY / 1000)).toFixed(0)} reports a second`);

const lat = { report: [], settle: [], analysis: [] };
const errors = new Map();
const err = (what, r) => errors.set(`${what} ${r.status}`, (errors.get(`${what} ${r.status}`) ?? 0) + 1);
const depth = [];
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    const [m] = await sql(`select queue_length from pgmq.metrics('game_reports')`).catch(() => [{ queue_length: -1 }]);
    depth.push(Number(m.queue_length));
    await sleep(5000);
  }
})();

async function play(k) {
  const id = games[k].id;
  const red = tokens[2 * k];
  const black = tokens[2 * k + 1];
  const moves = randomGame(PLIES);
  const clocks = { red: 300000, black: 300000 };
  await sleep(Math.random() * PER_PLY);
  for (let ply = 1; ply <= moves.length; ply++) {
    const report = { kind: "move", ply, iccs: moves[ply - 1], clocks: { ...clocks }, hash: "x" };
    // Both browsers report each move.
    for (const t of [red, black]) {
      const r = await rpc(t, "report_game", { p_game: id, p_report: report });
      lat.report.push(r.ms);
      if (!r.ok) err("report_game", r);
    }
    await sleep(PER_PLY);
  }
  return { id, moves, red, black };
}

const played = await Promise.all(games.map((_, k) => play(k)));
console.log("All games played; everyone resigns at once.");
await Promise.all(
  played.flatMap(({ id, moves, red, black }) =>
    [red, black].map(async (t) => {
      const end = { kind: "end", result: { winner: "black", reason: "resign" }, moves, clocks: { red: 1000, black: 1000 } };
      let r = await rpc(t, "report_game", { p_game: id, p_report: end });
      if (!r.ok) err("end report", r);
      for (let i = 0; i < 10; i++) {
        r = await gameFn(t, { game: id });
        lat.settle.push(r.ms);
        if (!r.ok) err("settle", r);
        if (r.data?.status === "over") break;
        await sleep(3000);
      }
    }),
  ),
);
console.log("Settled; both browsers send their analysis.");
await Promise.all(
  played.flatMap(({ id, moves, red, black }) => {
    const analysis = { v: 1, depth: 8, positions: Array.from({ length: moves.length + 1 }, (_, i) => ({ b: moves[i] ?? null, s: [20, 10, -30] })) };
    return [red, black].map(async (t) => {
      const r = await gameFn(t, { game: id, analysis });
      lat.analysis.push(r.ms);
      if (!r.ok) err("analysis", r);
    });
  }),
);
sampling = false;
await sampler;

const [after] = await sql(`select pg_total_relation_size('public.game_log') + pg_total_relation_size('public.games') + pg_total_relation_size('public.game_analysis') as bytes`);
const [state] = await sql(`select count(*) filter (where status = 'over') as over, count(*) filter (where fairplay->>'status' = 'checked') as checked
  from public.games where id = any(array[${games.map((g) => `'${g.id}'::uuid`).join(",")}])`);
console.log(`\n${G} games × ${PLIES} plies`);
console.log("report_game ms", summary(lat.report));
console.log("settle (game fn) ms", summary(lat.settle));
console.log("analysis (game fn) ms", summary(lat.analysis));
console.log("queue depth every 5 s:", depth.join(" "));
console.log("games over:", state.over, "checked:", state.checked);
console.log(`storage: ${((Number(after.bytes) - Number(sizeBefore[0].bytes)) / G / 1024).toFixed(1)} KB a game`);
console.log("errors", Object.fromEntries(errors));
