# Playground

Development app for the shared packages (not the production site).

- `#/analysis` — analysis board (M3): Fairy-Stockfish in the browser with eval bar, up to 3 lines and
  arrows; move tree with variations, comments, promote/delete; keyboard ← → Home End; position editor
  with live legality checks; FEN/PGN import and export; share links (`#/analysis?fen=…&moves=…`);
  saved analyses in IndexedDB.
- `#/play` — two players on one screen (M2).

Run: `pnpm --filter playground dev` → http://127.0.0.1:5173

The dev and preview servers send COOP/COEP headers (the engine uses threads), and the engine files
are served from the `fairy-stockfish-nnue.wasm` package at `/engine/fairy/` (copied into `dist` on build).
Any production host must send the same headers, including on the engine's worker script.
