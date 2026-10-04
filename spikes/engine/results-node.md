# Engine spike — 2026-10-04, Node v24.21.0, Intel(R) Core(TM) i7-3520M CPU @ 2.90GHz (4 threads)

## Fairy-Stockfish (npm fairy-stockfish-nnue.wasm 1.1.12, classical eval)
download: js 63 KB, wasm 1598 KB, net none (total 1.6 MB); load 50 ms
| threads | position | movetime | depth | nodes | nps | score | best |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | start | 1000 ms | 11/14 | 67,553 | 66,884 | cp 42 | c1e3 |
| 1 | start | 5000 ms | 14/17 | 433,248 | 86,424 | cp 14 | c1e3 |
| 1 | opening | 1000 ms | 11/12 | 88,687 | 87,548 | cp -8 | i4i5 |
| 1 | opening | 5000 ms | 14/16 | 422,387 | 84,241 | cp 0 | c4c5 |
| 4 | start | 1000 ms | 10/11 | 177,378 | 175,274 | cp 32 | d1e2 |
| 4 | start | 5000 ms | 13/17 | 944,354 | 188,757 | cp 6 | h1g3 |
| 4 | opening | 1000 ms | 10/12 | 205,476 | 203,039 | cp 0 | b1c3 |
| 4 | opening | 5000 ms | 13/19 | 940,242 | 186,964 | cp -6 | c4c5 |

## Fairy-Stockfish (npm fairy-stockfish-nnue.wasm 1.1.12, NNUE xiangqi-c07e94a5c7cb)
download: js 63 KB, wasm 1598 KB, net 10.7 MB (total 12.4 MB); load 41 ms
| threads | position | movetime | depth | nodes | nps | score | best |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | start | 1000 ms | 15/19 | 113,783 | 112,322 | cp 47 | b3e3 |
| 1 | start | 5000 ms | 18/23 | 610,638 | 121,932 | cp 41 | b3e3 |
| 1 | opening | 1000 ms | 13/18 | 126,961 | 126,581 | cp 12 | i1h1 |
| 1 | opening | 5000 ms | 17/24 | 534,824 | 106,644 | cp 40 | i1h1 |
| 4 | start | 1000 ms | 13/6 | 240,924 | 232,776 | cp 39 | h3e3 |
| 4 | start | 5000 ms | 16/19 | 1,246,185 | 248,739 | cp 26 | b3e3 |
| 4 | opening | 1000 ms | 13/17 | 297,504 | 295,729 | cp 33 | b3d3 |
| 4 | opening | 5000 ms | 16/22 | 1,513,549 | 302,286 | cp 25 | g4g5 |

## Pikafish (official source 1c66b9b2, built here with Emscripten 3.1.74)
download: js 88 KB, wasm 651 KB, net 47.7 MB (total 48.4 MB); load 969 ms (process start to readyok, includes Node startup and net load)
| threads | position | movetime | depth | nodes | nps | score | best |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | start | 1000 ms | 16/28 | 159,312 | 158,835 | cp 16 | h2e2 |
| 1 | opening | 1000 ms | 17/28 | 169,004 | 168,666 | cp 12 | i0h0 |
| 1 | start | 5000 ms | 21/28 | 813,532 | 162,641 | cp 20 | g3g4 |
| 1 | opening | 5000 ms | 21/33 | 847,280 | 169,456 | cp 11 | b0c2 |
| 4 | start | 1000 ms | 17/23 | 415,571 | 415,571 | cp 18 | c3c4 |
| 4 | opening | 1000 ms | 18/26 | 455,074 | 454,165 | cp 14 | g3g4 |
| 4 | start | 5000 ms | 21/34 | 2,115,279 | 422,717 | cp 16 | c3c4 |
| 4 | opening | 5000 ms | 21/30 | 2,170,537 | 433,760 | cp 14 | i0h0 |
