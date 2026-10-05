# Xiangqi site

A guest-first Xiangqi (Chinese chess) teaching and playing website, modeled on what makes chess.com work.

- Requirements study: https://claude.ai/code/artifact/ad1a27e3-de1c-451d-86c2-42aedf98b5e1
- MVP design: https://claude.ai/code/artifact/738d1d2e-55bf-49c6-9564-7f3b5d71e38b

## Layout

| Path | Purpose |
| --- | --- |
| `packages/xiangqi-core` | Rules, notation, FEN, game tree, PGN |
| `packages/board` | React SVG board component |
| `packages/engine` | Engine Web Worker + UCI wrapper, game review |
| `packages/puzzles` | Puzzle rating, selection, generator (M6) |
| `packages/content` | Lessons, bots and puzzles compiled into one module |
| `packages/ui` | The site's pages, shared by the website and the playground |
| `apps/web` | The website: Next.js static export, `/zh` and `/en` (M7). See `apps/web/DEPLOY.md` |
| `apps/playground` | Dev playground: two-player board (M2) and analysis board (M3) (`pnpm --filter playground dev`) |
| `packages/bots` | Bot personalities and move choice (M4) |
| `packages/lessons` | Lesson format, step logic, content validator (M5) |
| `content/` | Lessons (11), bots (8), puzzles (294) |
| `spikes/engine` | M0: engine size and speed comparison |

## Requirements

Node 24+ and pnpm (`corepack enable pnpm`).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm -r --filter "./packages/*" test` | Unit tests |
| `pnpm --filter web dev` | Website dev server, http://localhost:3000 |
| `pnpm --filter web build` | Static export to `apps/web/out/` |
| `pnpm --filter web serve` | Serve the export with production headers, port 4000 |
| `pnpm --filter web e2e` | End-to-end and accessibility tests (system Chrome) |
| `pnpm --filter web budget` | JS size budget |
| `pnpm --filter playground dev` | Hash-routed dev playground, http://127.0.0.1:5173 |
