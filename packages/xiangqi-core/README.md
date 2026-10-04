# xiangqi-core

Xiangqi rules in pure TypeScript: positions, legal moves, notation and game-end rulings.
No UI or engine dependencies; used by the board, bots, lessons, puzzles and (later) the game server.

```ts
import { Game } from "xiangqi-core";

const g = new Game();          // start position (or new Game(fen))
g.move("C2.5");                // WXF, Chinese ("炮二平五") or ICCS ("h2e2")
g.move("马８进７");
g.history.map((r) => r.chinese); // ["炮二平五", "马８进７"]
g.result;                      // null, or { winner, reason, text: { en, zh } }
```

## What it covers

| Area | Details |
| --- | --- |
| Board | 90 points, square = rank × 9 + file; Red on ranks 0–4 |
| Moves | All piece rules incl. hobbled horse, blocked elephant eye, river, palace, cannon screens, soldiers sideways after the river, flying general |
| FEN | Standard Xiangqi FEN in and out; `h`/`e` accepted for horse/elephant |
| Validation | `Position.validate()` rejects impossible set-ups (generals facing, side not to move in check, pieces off their points, too many pieces); `new Game(fen)` throws on them |
| Notation | ICCS, WXF and Chinese output; tandem pieces (前/后, 前/中/后); parsing accepts all three, traditional characters and full-width digits |
| Game end | Checkmate and stalemate (both lose), repetition rulings (perpetual check, perpetual chase of the same unprotected piece, mutual cases, idle draw) on the third occurrence, natural move limit |

One rule set only: standard Xiangqi (World Xiangqi Federation rules).

## Testing

- `pnpm test` — 62 tests: perft (start position to depth 4: 3,290,240), cross-checked positions, notation, movement and rulings.
- `pnpm build && pnpm crosscheck [games] [depth]` — compares per-move perft with Fairy-Stockfish on hand-picked and random-game positions (needs the engine spike package installed).

## Known limits / to do

- `NATURAL_LIMIT_MOVES = 50` comes from a summary of the World Xiangqi rules; confirm against the official text.
- Chase rulings follow the core WXF principles; the full official case list (e.g. chases by several pieces, cannon-mount cases) still needs a test suite of ruled positions.
- WXF notation for three or more soldiers on one file uses a provisional `a`/`b`/`c` marker.
- Perft depth 4 takes about 9 s; fine for rules, would need optimisation only if used for search.
