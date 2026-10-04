# M0 — Engine spike

Question: which Xiangqi engine should run in the browser, given download size, load time and strength?

Run it: `./build-pikafish.sh` (once), then `node bench.mjs all` (or `fairy`, `fairy-nnue`, `pikafish`;
options `--threads=1,4 --times=1000,5000`). Full numbers: [results-node.md](results-node.md).

## Candidates

| Engine | Source | Download | Strength limits for bots |
| --- | --- | --- | --- |
| Fairy-Stockfish, classical eval | npm `fairy-stockfish-nnue.wasm` 1.1.12 (GPL-3.0) | 1.6 MB | Yes: `Skill Level` -20..20, `UCI_LimitStrength` + `UCI_Elo` 500..2850 |
| Fairy-Stockfish + NNUE | same + `xiangqi-c07e94a5c7cb.nnue` (trained by the Pikafish developers) | 12.4 MB | Yes (same options) |
| Pikafish | official source `1c66b9b2`, built here with Emscripten 3.1.74 (GPL-3.0) | 48.4 MB (net 47.7 MB, already zstd-compressed) | No: weaken by MultiPV sampling in our code |

## Results (Node 24, Intel i7-3520M, 2012 dual-core laptop — a stand-in for a mid-range phone)

Depth reached from the start position (other position similar):

| Engine | 1 thread, 1 s | 1 thread, 5 s | 4 threads, 1 s | 4 threads, 5 s | Speed (1 thread) | Load |
| --- | --- | --- | --- | --- | --- | --- |
| Fairy-Stockfish classical | 11 | 14 | 10 | 13 | ~80k nodes/s | 50 ms |
| Fairy-Stockfish NNUE | 15 | 18 | 13 | 16 | ~115k nodes/s | 40 ms + net |
| Pikafish | 16 | 21 | 17 | 21 | ~160k nodes/s | ~1 s (net load) |

All three choose sensible moves (Pikafish: central cannon h2e2 at the start). Depths are not directly
comparable across engines, but Pikafish is the strongest Xiangqi engine and reaches the greatest depth here.
Four threads give 2.6x the nodes on this dual-core machine.

## Recommendation

Use two engines, by job:

1. **Default engine: Fairy-Stockfish** (1.6 MB, loads instantly). Powers bots, lesson play-outs, puzzle
   checks, the post-game quick pass and the analysis board's first eval. Built-in `UCI_Elo` makes the
   bot ladder (250–2000) simple. Optionally load its 10.7 MB NNUE net for the top bots.
2. **Strong engine: Pikafish**, opt-in on the Analysis page ("Load strong engine — 48 MB, once"), with a
   progress bar and Cache Storage so it downloads once. Never forced on phones.
3. **Server/CI side: native Pikafish** for validating puzzles and, in phase 2, Game Review.

## Findings to carry into `packages/engine`

- Fairy-Stockfish ignores `setoption name UCI_Variant value xiangqi` if sent before `uci`, and then plays chess.
- Fairy-Stockfish numbers ranks 1–10 (`b1c3`); ICCS/Pikafish use 0–9 (`b0c2`). The wrapper converts.
- The old Fairy glue calls `fetch()` on a file path in Node; pass `wasmBinary` instead.
- Upstream Pikafish's `wasm32` target needs three build workarounds (see `build-pikafish.sh`).
- Upstream Pikafish reads UCI from stdin on its main thread, which blocks output during a search. Browser use
  needs a small patch exporting `initialize()` / `command(line)` entry points, as other browser
  Pikafish builds do (about 60 lines).
- Both engines use pthreads, so pages hosting them must be cross-origin isolated (COOP `same-origin`,
  COEP `require-corp` or `credentialless`).
- Not yet measured: the same engines inside Chrome and on a real phone. Do this when `packages/engine` exists.
