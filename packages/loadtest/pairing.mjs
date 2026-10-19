// Quick pairing under load (M20): N players seek on the six tiles and poll find_match every
// 2.5 s, as the Play online page does; once matched they take a short break (standing in for
// the game) and seek again. Reports find_match and seek latency, time to a match, and errors,
// and the database's own time per call.
//
//   node packages/loadtest/pairing.mjs --players 200 --seconds 120
import { arg, rpc, signInAll, sleep, sql, summary } from "./lib.mjs";

const N = arg("players", 100);
const SECONDS = arg("seconds", 90);
const TILES = [[120, 1], [60, 2], [300, 3], [180, 2], [600, 5], [900, 10]];
const FILTERS = { range: 400, established: false, account_age: 0, completion: 0, checked: false };

console.log(`Signing in ${N} players…`);
const tokens = await signInAll(N);
await sql(`delete from public.seeks; select pg_stat_statements_reset();`).catch(() => sql(`delete from public.seeks`));

const lat = { find: [], seek: [] };
const waits = [];
let matches = 0;
const errors = new Map();
const err = (what, r) => errors.set(`${what} ${r.status}`, (errors.get(`${what} ${r.status}`) ?? 0) + 1);
const end = Date.now() + SECONDS * 1000;

async function player(i) {
  // Spread players over the tiles, most on the main Blitz tile, as real players would be.
  const tile = i % 3 === 0 ? TILES[i % 6] : TILES[2];
  await sleep(Math.random() * 2500);
  while (Date.now() < end) {
    let r = await rpc(tokens[i], "seek", { p_base: tile[0], p_inc: tile[1], p_filters: FILTERS, p_relay: false });
    lat.seek.push(r.ms);
    if (!r.ok) {
      err("seek", r);
      await sleep(2500);
      continue;
    }
    const started = Date.now();
    while (Date.now() < end) {
      await sleep(2500);
      r = await rpc(tokens[i], "find_match");
      lat.find.push(r.ms);
      if (!r.ok) {
        err("find_match", r);
        continue;
      }
      if (r.data?.status === "matched") {
        matches++;
        waits.push(Date.now() - started);
        await sleep(5000 + Math.random() * 10000);
        break;
      }
    }
  }
}

const progress = setInterval(() => console.log(`… ${lat.find.length} find_match calls, ${matches} matched`), 15000);
await Promise.all(tokens.map((_, i) => player(i)));
clearInterval(progress);
await Promise.all(tokens.map((t) => rpc(t, "cancel_seek")));

const calls = lat.find.length / SECONDS;
console.log(`\n${N} players, ${SECONDS} s: ${calls.toFixed(1)} find_match calls a second`);
console.log("find_match ms", summary(lat.find));
console.log("seek ms      ", summary(lat.seek));
console.log("time to match ms", summary(waits), `(${matches / 2} games)`);
console.log("errors", Object.fromEntries(errors));
const db = await sql(`select regexp_replace(query, '\\s+', ' ', 'g') as q, calls, round(mean_exec_time::numeric, 2) as mean_ms, round(max_exec_time::numeric, 1) as max_ms
  from pg_stat_statements where query ~* 'find_match|public\\.seek\\(' order by calls desc limit 4`).catch((e) => [{ q: String(e).slice(0, 80) }]);
console.table(db.map((r) => ({ ...r, q: String(r.q).slice(0, 60) })));
