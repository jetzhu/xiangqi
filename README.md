# Xiangqi site

A free, bilingual (中文 / English) Xiangqi (Chinese chess) site for learning and playing, modeled on what makes chess.com work.

**Play it now: https://jetzhu.github.io/xiangqi/**

No account is needed: progress is saved in the browser. A free account keeps it on every device.

## What's on the site

- **Learn:** 11 short interactive lessons, from the board to your first game, with learning ranks.
- **Puzzles:** 578 puzzles with a puzzle rating, hints, a daily puzzle, and stats by theme.
- **Play bots:** 8 bots from 250 to 2000, each with its own style, plus a bot rating for rated games.
- **Analysis:** a board with a strong engine (it runs in your browser), and game review with accuracy.
- **Stats and history:** ratings over time, past games, a learning streak and milestones.
- **Accounts** (optional): sign up with email, Google, Microsoft or GitHub. Your progress, games, puzzles and settings sync across devices. There's also a profile page; data export; and account deletion, which waits 10 days.

The site uses standard Xiangqi rules only.

## Design documents

In [`docs/`](docs/):

- [Requirements study](docs/requirements.md): what makes chess.com work, and what that means for this site
- [MVP design](docs/mvp-design.md): the guest-first site (milestones M0–M7b)
- [v0.2 accounts design](docs/v0.2-accounts-design.md): optional accounts and sync (milestones M8–M14)

## Layout

| Path | Purpose |
| --- | --- |
| `packages/xiangqi-core` | Rules, notation, FEN, game tree, PGN |
| `packages/board` | React SVG board component |
| `packages/engine` | Engine Web Worker + UCI wrapper, game review |
| `packages/bots` | Bot personalities and move choice |
| `packages/lessons` | Lesson format, step logic, content validator |
| `packages/puzzles` | Puzzle rating, selection, generator |
| `packages/content` | Lessons, bots and puzzles compiled into one module |
| `packages/ui` | The site's pages, shared by the website and the playground |
| `packages/records` | Server-side checks for bot games and puzzle attempts before they are rated |
| `packages/db` | Supabase project: migrations, auth settings, edge function. See `packages/db/README.md` |
| `apps/web` | The website: Next.js static export, `/zh` and `/en`. See `apps/web/DEPLOY.md` |
| `apps/playground` | Dev playground: two-player board and analysis board |
| `content/` | Lessons (11), bots (8), puzzles (578) |
| `docs/` | Design documents |
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
| `pnpm --filter @xq/db apply -- --dry-run` | Show pending database changes (needs `SUPABASE_ACCESS_TOKEN`) |
| `pnpm --filter @xq/db functions -- --dry-run` | Bundle the edge function without deploying |
| `pnpm --filter playground dev` | Hash-routed dev playground, http://127.0.0.1:5173 |

## Deploying

Every push to `main` runs the tests and publishes the site to https://jetzhu.github.io/xiangqi/ through GitHub Actions (`.github/workflows/pages.yml`).
Database changes and the edge function are deployed separately with the `@xq/db` scripts above.
Releases are tagged `v0.1.x`.
