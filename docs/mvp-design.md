# Xiangqi Site — MVP Design

> A copy of the project's design document, exported 2026-10-10. Diagrams are not included.

Oct 4, 2026 · @Jet

## Goals and scope

The MVP is a guest-first Xiangqi learning site: a visitor can learn the rules, solve puzzles, play bots and analyse positions in English or Simplified Chinese, without an account and with no game server. It implements requirements R1–R9 from the [chess.com feature study](requirements.md).

| ID | MVP requirement | Done when |
| --- | --- | --- |
| R1 | Shared Xiangqi board component | Same component used on every page; drag and click moves; legal-move dots; arrows; flip; sounds |
| R2 | Rules engine, standard Xiangqi rules | Passes a move-generation test suite (perft) and repetition/perpetual test positions |
| R3 | In-browser engine | Eval bar and top 3 lines on a mid-range laptop and phone without a server |
| R4 | Analysis board | Set up position, FEN and notation import/export, variations tree |
| R5 | Play vs bots | 8 graded bots with names and chat lines; hint, takeback, assist toggles |
| R6 | Beginner learn path | One lesson per piece plus river, palace, check and checkmate; challenges with progress |
| R7 | Puzzles | Puzzle stream from mate-in-1 up, with local puzzle rating, hint, retry, analyse |
| R8 | Guest mode | All of the above with progress saved in the browser; "sign up to keep progress" prompt only |
| R9 | Bilingual UI, two piece styles | Every string in EN and zh-CN; traditional-character and icon pieces |

**Design principles** (taken from what makes chess.com work)

1. One board everywhere: the board is the product; every feature is a panel beside it.
2. A coach narrates: lessons, puzzles and bots speak through a character in a speech bubble.
3. Instant feedback on every move: legal moves shown, right/wrong marked at once, short reason given.
4. Help is a dial, not a switch: hints, arrows and eval can each be turned on or off.
5. Value before sign-up: guests get the full MVP; accounts only add saving across devices.

**Out of scope for the MVP:** accounts and login, online play vs humans, ratings and leaderboards, Game Review, courses and payments, Classroom, community features, mobile apps. The design keeps room for each (see Architecture).

## Architecture at a glance

*(Diagram not included in this copy: MVP architecture · browser modules, static host, later backend.)*

Pages load from a static host. Each page drives the board and its feature store, and every rule question goes to `xiangqi-core`. The engine runs in a worker, and progress stays in IndexedDB. The phase 2 backend plugs in later for sync and live play, reusing the same core so client and server agree on every move.

## Tech stack

Use TypeScript end to end, a statically generated web app, and a WebAssembly engine in a Web Worker. The MVP then runs with no server of our own, only a static host and CDN.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) | One language for rules core, UI and future backend; types catch move/notation bugs |
| Web framework | Next.js (App Router), static generation for lesson, opening and puzzle-set pages | Each lesson gets its own indexable URL and title, as chess.com does; client components for interactive pages |
| Board rendering | SVG, own React component | Crisp at any size, easy arrows and highlights, accessible labels; 90 points is light for SVG |
| Rules core | Own package `xiangqi-core`, pure TypeScript, no UI deps | Shared by board, bots, puzzles, lessons and later the game server; fully unit-tested |
| Engine | Fairy-Stockfish WASM by default (1.6 MB) plus Pikafish WASM as an opt-in strong engine (48 MB, cached), both in Web Workers over UCI | Decided by the M0 spike (see Engine spike results): instant load for everyday use, full strength when asked for |
| State | Zustand per page | Small, simple, works with React server components |
| Local storage | IndexedDB via `idb-keyval`, versioned schema | Guest progress, settings, saved analyses; survives reloads |
| i18n | `next-intl`, message files `en` and `zh-CN`; content files per locale | Route per locale (`/en/...`, `/zh/...`), good for SEO in both languages |
| Styling | CSS variables for themes + Tailwind for layout | Board and piece themes swap by variables; dark mode by default |
| Sound | Web Audio with preloaded short clips | Low-latency move, capture, check sounds; mute toggle |
| Tests | Vitest (core, components), Playwright (end-to-end flows), perft suite | Rules correctness is the foundation; e2e covers lesson/puzzle/bot flows |
| Hosting | Static host with global CDN (e.g. Cloudflare Pages or Vercel) | Fast worldwide, near-zero cost at MVP scale |
| Later backend (phase 2) | Node (Fastify) + PostgreSQL + Redis, WebSocket game server reusing `xiangqi-core` | Server validates moves with the same rules code the client uses |

The repo is one monorepo (pnpm workspaces): `packages/xiangqi-core`, `packages/board` (React board), `packages/engine` (worker + UCI wrapper), `apps/web`, `content/` (lessons, puzzles, bots).

## Xiangqi core (`xiangqi-core`)

The core is a pure TypeScript library that owns the position, legal moves, game end and every notation. Nothing else in the app knows the rules.

**Board model**

- 9 files × 10 ranks = 90 points. Index = rank × 9 + file (0–89), Red on ranks 0–4, Black on 5–9. Precomputed tables for palace points, river side, horse legs and elephant eyes make move generation simple lookups.
- Pieces: K General, A Advisor, B Elephant, N Horse, R Chariot, C Cannon, P Soldier; upper case Red, lower case Black.
- Position = 90-cell array + side to move + no-capture counter + move number + 64-bit Zobrist hash (two 32-bit halves).
- Start position FEN: `rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1`.

**Move generation and legality**

1. Generate pseudo-legal moves per piece: General and Advisor inside the palace; Elephant two points diagonally, blocked eye, never across the river; Horse one orthogonal then one diagonal, blocked leg; Chariot slides; Cannon slides to move, jumps exactly one screen to capture; Soldier forward, plus sideways after crossing the river.
2. Make the move, reject it if the own General is attacked or the two Generals face each other on an open file (flying general).
3. Stalemate (no legal move) is a loss for the side to move.
4. Verified with perft counts from the start and tricky positions, cross-checked against the engine's own perft.

**Notation**

| Format | Example | Use |
| --- | --- | --- |
| ICCS coordinates | `h2e2` | Internal, engine (UCI), URLs |
| WXF | `C2.5` (also `C2=5`) | English UI, imports |
| Chinese | 炮二平五 / 炮8平5 | Chinese UI: Red uses Chinese numerals, Black Arabic; 前/后 for two pieces on one file |
| FEN | above | Positions, puzzles, sharing |
| PGN with `[Variant "xiangqi"]` | moves in ICCS | Game import/export; XQF and other formats in a later phase |

The UI picks WXF or Chinese by language, with a setting to override.

**Game end and repetition rulings**

- Every position's hash is stored in the history; a repetition is the same hash with the same side to move.
- Each move in the repeating cycle is classed as check, chase (attacks an unprotected piece, or a protected Chariot with a Horse or Cannon) or idle.
- Rulings: one side checking perpetually while the other doesn't → the checker loses. Both perpetual → draw. Idle repetition → draw. Perpetual chase follows the same pattern.
- One rule set, not configurable: standard Xiangqi, the game the international and regional bodies standardise. Long-chase edge cases follow the World Xiangqi Federation rule text and are the hardest part to test.
- No-capture limit: a counter with the standard limit from the same rule text, shown when it gets close.
- Every ending returns a machine reason plus a plain sentence in both languages, e.g. "Red loses: perpetual check".

**Engine integration (`packages/engine`)**

- One engine per browser tab in a Web Worker; the main thread sends UCI text: `position fen … moves …`, `go movetime|depth`, `setoption MultiPV`, `stop`.
- A small parser turns `info` lines into `{depth, multipv, scoreCp | mate, pv[]}`; scores are normalised to Red's point of view for the eval bar.
- Any new request cancels the old one (`stop`), so dragging through a game never queues work.
- Bots use the same worker with limits: depth/node caps, MultiPV sampling with a temperature, and personality weights (see Feature designs).

## Board component (`packages/board`)

One React component, `<XiangqiBoard>`, draws the board and handles input. It is controlled: the page passes a position and callbacks, the board never decides rules itself (it asks `xiangqi-core` for legal moves).

**API sketch**

```ts
<XiangqiBoard
  fen={fen}
  orientation="red" | "black"
  movable="red" | "black" | "both" | "none"
  legalMoves={core.legalMoves(fen)}
  onMove={(move) => …}          // ICCS, e.g. "h2e2"
  lastMove={"h2e2"}
  arrows={[{from:"h2", to:"e2", color:"green"}]}
  highlights={[{point:"e2", kind:"hint" | "check" | "good" | "bad"}]}
  badges={[{point:"e2", icon:"blunder"}]}   // move-label icons
  pieceSet="traditional" | "icons"
  theme="wood" | "green" | "high-contrast"
  showCoordinates
/>
```

**Interaction**

- Drag and drop, click-click, or both (setting). Legal destination points show as dots; captures as rings.
- Illegal drop snaps back and fires `onIllegal(reason)` so pages can explain ("The horse's leg is blocked").
- Right-click drag draws arrows; right-click on a point marks it; a left click clears them. This is used in analysis and lessons.
- Premove hook kept in the API for later live play (off in the MVP).
- Animations: slide for moves, short fade for captures; a General in check pulses red.

**Rendering**

- SVG viewBox in grid units: 9 × 10 points, lines, river band with 楚河 / 汉界 text, palace diagonals, cross marks on cannon and soldier start points.
- Pieces are round discs: traditional set uses characters (帅仕相傌车炮兵 / 将士象马车砲卒) in red and black; the icon set uses simple shape symbols for learners who don't read Chinese.
- Size follows its container; works from 320 px phone width up.
- Coordinates: files 1–9 from each player's right (WXF style) or a–i (ICCS style), ranks 0–9, by setting.

**Accessibility**

- Each point is a focusable cell with a label ("e2, Red Cannon"); arrow keys move focus, Enter selects and moves.
- A live region announces moves in the current notation.
- High-contrast theme and an option to turn off animations; red/black also differ in piece outline, not just colour.

## Feature designs

Every feature page has the same layout: board on the left (top on phones), a task panel on the right (below on phones), and a coach bubble at the top of the panel.

### Play vs bots (R5)

- **Bot picker:** 8 bots in 4 groups (Beginner, Casual, Club, Master), each with avatar, name, rating label, one-line personality, bilingual chat lines. Example ladder: 250, 400, 600, 800, 1000, 1300, 1600, 2000 (labels only; there are no player ratings in the MVP).
- **Options:** colour (Red, Black, random), timer (none, 10 min, 15+10, 30 min) and assist toggles: hint, takeback, eval bar, threat arrows, suggestion arrows, move feedback. Presets: Learn (all on), Fair (hint only), Challenge (all off).
- **How bots play:** the engine runs MultiPV 3–5 under a node limit set per bot; the bot samples among the lines with a temperature, so weak bots drop material on purpose. Personality weights nudge choices: aggressive (prefers checks/captures), defensive, cannon lover, and so on. A small opening book per bot gives each one a recognisable style.
- **During the game:** move list with live opening name, Resign (confirm), Takeback, Hint (first highlights the piece, a second press shows the arrow), bot chat on events (check, capture, blunder, win).
- **After the game:** result card, bot reaction, move-label counts (Book, Best, Good, Inaccuracy, Mistake, Blunder) from a quick engine pass, Rematch, New Bot, Analyse. Beating a bot earns a crown stored locally.

### Learn path (R6)

- **Path map:** units as a winding path of nodes; the next lesson glows and says "Next". Units: The Board; General; Advisor; Elephant; Horse; Chariot; Cannon; Soldier; Check and Checkmate; Special rules (flying general, stalemate loses, perpetual check); Your first game.
- **Lesson player:** a lesson is a list of steps. Step types:
  1. `explain`: coach text, optional arrows/highlights on a fixed position.
  2. `show-moves`: the piece's legal moves drawn as arrows (e.g. the Horse with a blocked leg).
  3. `capture-stars`: move the piece to collect stars within N moves; progress bar.
  4. `find-move`: one correct move (or a set), coach feedback on wrong tries.
  5. `play-out`: play a short position against the engine until a goal (mate, win material).
  6. `quiz`: multiple choice ("Can this elephant cross the river?").
- **Completion:** each lesson ends with a summary; finishing all challenges marks it mastered. Progress saves locally and feeds a "Learning Rank" from Soldier to General.

### Puzzles (R7)

- **Stream:** the next puzzle is picked near the learner's local puzzle rating (Glicko-style update after each solve: success, time, hints used). The first five are fixed mate-in-1 onboarding puzzles.
- **Solving:** "Red to move" with a goal line from the coach ("Win the chariot"); the opponent's replies play automatically; a wrong move is shown, explained in one line, then Retry. Hint highlights the piece, then the destination.
- **After:** green check, rating change, Next, Retry, Analyse (opens the analysis board at that position), theme tags (fork, discovered check, cannon screen, horse mate).
- **Sources:** composed endgames and classical-manual positions converted to FEN, plus engine-verified positions from master games (see Data and content).

### Analysis board (R4, R3)

- Start from: new game, set up position (piece palette + side to move + legality check), paste FEN or PGN, or "Analyse" from any game, puzzle or lesson.
- Engine panel: on/off, eval bar, top 3 lines with scores in both notations, depth, MultiPV setting.
- Move tree with variations (click a move in a line to branch), comments, arrow and point markup, back/forward with arrow keys.
- Export FEN, PGN and a share link (position and moves in the URL). Saved analyses stay in the browser.

## Page map and navigation

*(Diagram not included in this copy: MVP page map · 5 sections, Analysis reachable from every board.)*

A left sidebar (bottom bar on phones) lists the five sections plus the language switch. Home is a dashboard of next-step cards: next lesson, next puzzle, last bot, plus a "Sign up to keep your progress" note.

## Data and content

All MVP content is static files in the repo, built into pages at deploy time. All learner data lives in the browser under one versioned key, ready to upload to an account in phase 2.

**Content formats** (`content/`)

| Content | Format | Fields |
| --- | --- | --- |
| Lesson | One JSON file per lesson, text in both locales | `id`, `unit`, `order`, `title{en,zh}`, `steps[]` (type, fen, arrows, highlights, goal, solution moves, coach text{en,zh}, wrong-move hints) |
| Puzzle | JSON Lines, one puzzle per line, bundled into sets by rating band | `id`, `fen`, `solution[]` (ICCS, alternating sides), `rating`, `themes[]`, `source`, `goal{en,zh}` |
| Bot | JSON per bot | `id`, `name{en,zh}`, `avatar`, `ratingLabel`, `nodes`, `multipv`, `temperature`, `style weights`, `openingBook[]`, `chat{event: lines{en,zh}}` |
| Openings (names only in MVP) | JSON tree keyed by ICCS move sequences | `name{en,zh}` for the live opening label |
| UI strings | `messages/en.json`, `messages/zh-CN.json` | key → text |

**Authoring pipeline**

1. Authors write lessons in a simple editor page (dev-only route) that uses the real board to set positions, record solutions and type both languages.
2. A validation script checks every FEN is legal, every solution move is legal in sequence, every puzzle's first move is the engine's top choice by a clear margin, and both locales are filled.
3. CI runs the validator; a broken lesson or puzzle fails the build.

**Puzzle sourcing:** convert public-domain classical manuals and composed endgames to FEN by hand-entry with the editor; generate tactical puzzles from master games by scanning for positions where the best move wins by a large margin and the second best does not. Each puzzle records its source.

**Guest data (IndexedDB, key `xq:v1`)**

| Store | Contents |
| --- | --- |
| `settings` | language, notation, piece set, theme, sounds, move method, assist defaults |
| `lessons` | per lesson: status (new, started, mastered), step reached, stars |
| `puzzles` | rating, rating deviation, history of puzzle id, result, time, hints |
| `bots` | crowns earned, last bot played, last options |
| `analyses` | saved analyses: title, PGN, date |

A schema version number allows migrations; an "Export my data" button downloads the JSON. Phase 2 sync uploads the same structure to the account.

## Non-functional requirements

| Area | Target |
| --- | --- |
| Languages | Every UI string and all content in `en` and `zh-CN`; language picked from the browser, switchable anytime; notation follows language unless overridden |
| Performance | First load of a lesson page under 2 s on a mid-range phone on 4G; board interaction under 16 ms per frame; engine loads lazily only on pages that need it |
| Engine size | Engine + network download kept small enough for phones (target set after the spike); cached by a service worker after the first load |
| Devices | Works from 320 px width; touch drag and tap; latest two versions of Chrome, Safari, Firefox, Edge |
| Accessibility | Keyboard play, screen-reader move announcements, high-contrast theme, reduced motion |
| Offline | Lessons, puzzles already loaded and bots work offline after the first visit |
| SEO | Per-locale URLs, a title and description per lesson and opening, sitemap, hreflang |
| Privacy | No accounts and no personal data in the MVP; cookie-free analytics only |
| Testing | Core: unit tests + perft + repetition-ruling suite; board: component tests; flows: Playwright for first lesson, first puzzle, bot game, analysis import |
| Licences | Engine licence obligations met (GPL engines: publish the engine source and keep it a separate file); content sources recorded per puzzle |

## Engine spike results (M0, done 2026-10-04)

Use two engines by job: Fairy-Stockfish (1.6 MB, loads in about 50 ms, built-in Elo limits) for bots, lessons, puzzles and first analysis; Pikafish (48.4 MB, strongest) as an opt-in "strong engine" on the Analysis page. Measured in Node 24 on a 2012 dual-core laptop, a stand-in for a mid-range phone; code and full numbers in `spikes/engine`.

| Engine | Download | Load | Depth, 1 thread, 1 s | Depth, 1 thread, 5 s | Speed, 1 thread | Bot strength limits |
| --- | --- | --- | --- | --- | --- | --- |
| Fairy-Stockfish, classical eval | 1.6 MB | 50 ms | 11 | 14 | \~80k nodes/s | Skill Level, UCI\_Elo 500–2850 |
| Fairy-Stockfish + Xiangqi NNUE | 12.4 MB | 40 ms + net | 15 | 18 | \~115k nodes/s | Same |
| Pikafish (built from official source) | 48.4 MB | \~1 s | 16 | 21 | \~160k nodes/s | None: MultiPV sampling in our code |

Carry-over notes:

- Fairy-Stockfish numbers ranks 1–10 while ICCS uses 0–9, so the engine wrapper converts moves.
- Fairy-Stockfish needs `UCI_Variant xiangqi` set after `uci`, or it silently plays chess.
- Pikafish's upstream wasm build needed three build workarounds and still needs a small entry-point patch for browser use.
- Both engines need cross-origin isolation (COOP/COEP headers) for threads.
- Not yet measured in Chrome or on a real phone.

## Improvements from the chess.com help center

A study of chess.com's help center on 2026-10-06 found ten changes the live site can take without a backend (requirements R47–R56). Two of them change rules already built: our move-grade bands are twice as wide as chess.com's, and a hinted puzzle solve should count as a fail, not a no-change.

| Area | Today | Change | Req. |
| --- | --- | --- | --- |
| Move grades | Win-chance loss bands 0.05 / 0.10 / 0.20 / 0.30 (`review.ts`); Best = engine move; Book | Tighten to 0.02 / 0.05 / 0.10 / 0.20; add Miss (a move that lets the opponent's mistake go unpunished) | R47 |
| Game review | Grade counts after a bot game, then open in analysis | Accuracy per side (calibrated to 50–95), eval graph, Next key moment, Retry from the mistake position | R48 |
| Bot wins | A crown per bot beaten | 1–3 stars per win: 3 with no help, 2 with 1–3 hints or takebacks, 1 with 4 or more | R49 |
| Puzzle rating | Hinted solve recorded, rating unchanged | A hint counts as a fail; difficulty Standard / Hard / Extra hard shifts the target rating; skip puzzles seen in the last 50 | R50 |
| Puzzle modes | Rated puzzles only | Puzzle Rush (3 min, 5 min, Survival; 3 strikes; local best); Daily puzzle picked from the date | R51, R52 |
| Streak | None | Any game, puzzle, lesson or review counts; 2 missed days forgiven; kept locally for guests | R53 |
| Play options | Move method, legal dots, sound, coordinates, themes; assist presets; two-step hints; rematch | Confirm move, confirm resign, animation speed with Off, Red always at the bottom, Abort before the first move; two-player auto-flip and optional clock | R54 |
| Accessibility | Keyboard play, screen-reader move announcements, reduced motion, high-contrast theme | Shortcut list page, announce in the chosen notation including Chinese, a colour-blind-safe theme, accessibility statement | R55 |
| Help | None | Help page with refresh steps and browsers; "new version available" prompt when the deployed build changes; bug-report link with version and browser | R56 |
| Lessons | Reset not offered | "Reset lesson progress" in Settings | R34 |

**Puzzle levels (2026-10-06).** Difficulty became a level choice: Match my rating, Beginner (<800), Standard (800–1199), Hard (1200–1599), Extra hard (1600+). Puzzles are graded by a difficulty score from a coach's review: length, quiet moves, sacrifices, tempting wrong tries, discovered checks and cannon screens, and defender choice. Mate in 1 is always Beginner, mates in 2–3 at least Standard, mates in 4+ at least Hard. The set grew from 294 to 578 (129 / 222 / 126 / 101 per level): a harder self-play run plus 58 classical compositions from 适情雅趣 via XiangqiBench (MIT), all re-verified at depth 16.

Already matching chess.com, so unchanged: assist presets (Learn / Fair / Challenge / Custom), two-step hints (piece first, then the move), legal-move dots on by default, a learning rank sized to our 11 lessons, Xiangqi repetition rulings in place of chess draw rules.

## Milestones

Build from the rules outward, so every later feature stands on tested code. No dates yet; each milestone ends with something you can try in a browser.

1. **M0 – Engine spike (done 2026-10-04):** run Pikafish and Fairy-Stockfish WASM in a worker; measure download size, load time and depth reached in 1 s on a laptop and a phone; pick one.
2. **M1 – `xiangqi-core`:** board model, move generation, legality, FEN, ICCS/WXF/Chinese notation, game end; perft and ruling test suites green. Done 2026-10-04: 62 tests, perft to depth 4, 65 positions cross-checked with Fairy-Stockfish, plus position validation.
3. **M2 – Board component:** SVG board, both piece sets, drag/click, legal dots, arrows, highlights, sounds, keyboard; a demo page where two people can play on one screen. Done 2026-10-04: @xq/board with 10 tests, apps/board-demo verified in Chrome, plus bilingual illegal-move explanations in the core.
4. **M3 – Analysis board:** engine panel, eval bar, move tree, set-up position, FEN/PGN import/export, share link. Done 2026-10-04 in apps/playground (#/analysis): Fairy-Stockfish in the browser at \~100–400k nodes/s, plus GameTree/PGN in the core and @xq/engine; opt-in Pikafish still to do.
5. **M4 – Play vs bots:** bot picker, 8 bots, assist toggles, hint/takeback, post-game card. Done 2026-10-04 in apps/playground (#/bots) with @xq/bots, content/bots/bots.json, opening names in the core and move grading in @xq/engine.
6. **M5 – Learn path:** lesson player with all six step types, path map, the first 11 units in both languages, local progress. Done 2026-10-05: @xq/lessons with a content validator (incl. an engine check that play-outs are winnable), 11 lessons / 51 steps, apps/playground #/learn.
7. **M6 – Puzzles:** puzzle player, local rating, first 300 validated puzzles across rating bands. 2026-10-05: player, rating and generator done (@xq/puzzles, #/puzzles); puzzles are mined from native-Pikafish self-play with a unique-solution filter, 294 puzzles generated and re-verified at depth 16 (weighted toward beginners; more hard puzzles to generate later).
8. **M7 – Polish and launch:** home page, settings, i18n review by native speakers, accessibility pass, performance budget, SEO, deploy. 2026-10-05: all done except the deploy and the native-speaker review. apps/web is a Next.js static export with /zh and /en pages, one static page per lesson, hreflang, sitemap and robots.txt. Playwright tests cover the first lesson, first puzzle, a bot game and PGN import, and axe finds no serious WCAG A/AA problems on 9 pages. Initial JS is 132 KB gz (budget 150), and the engine (0.47 MB gz) loads only on analysis and bots. The deploy guide is apps/web/DEPLOY.md; the hosting target and domain are still open.
9. **M7b – Help-center improvements:** the ten changes in the section above, as v0.1.x releases before accounts (v0.2) start. Done 2026-10-06 in 7 commits: all ten built, 13 UI unit tests and 29 end-to-end tests (also run as GitHub Pages serves the site), initial JS 133 KB gz. Puzzle difficulty offsets (0 / 150 / 300) and the Rush ramp (400 + 60 per puzzle) are our own numbers; chess.com doesn't publish its.

After launch, phase 2 starts with accounts and sync, then online play (requirements R10–R16 and R25–R46).

## Risks and open decisions

| Risk or decision | Impact | Plan |
| --- | --- | --- |
| Engine download too large for phones (NNUE network files can be tens of MB) | Slow first analysis on mobile | Confirmed: Pikafish is 48.4 MB. Use the 1.6 MB Fairy-Stockfish by default; Pikafish only on request, with progress bar and Cache Storage |
| GPL licence of Pikafish / Fairy-Stockfish | Must publish engine source | Keep the engine a separate worker file, link its source; our app code stays separate |
| Perpetual chase rules are complex | Wrong rulings anger players | Build a test suite from the official rule text of ruled positions; show the reason in plain words |
| Content volume (11 units, 300 puzzles, both languages) | The biggest effort, not code | Authoring editor + validator early (M5/M6); native-speaker review |
| Engine choice: decided 2026-10-04, Fairy-Stockfish default + Pikafish opt-in | Strength vs size and variants | Done; still measure both in Chrome and on a real phone in packages/engine |
| Product name and domain | Branding, SEO | Open |
| Who writes and reviews lessons | Quality of teaching | Open: in-house, hired coach, or community |
