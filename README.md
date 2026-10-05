# Xiangqi site

A guest-first Xiangqi (Chinese chess) teaching and playing website, modeled on what makes chess.com work.

- Requirements study: https://claude.ai/code/artifact/ad1a27e3-de1c-451d-86c2-42aedf98b5e1
- MVP design: https://claude.ai/code/artifact/738d1d2e-55bf-49c6-9564-7f3b5d71e38b

## Layout

| Path | Purpose |
| --- | --- |
| `packages/xiangqi-core` | Rules, notation, FEN (M1, done) |
| `packages/board` | React SVG board component (M2, done) |
| `packages/engine` | Engine Web Worker + UCI wrapper |
| `apps/web` | Next.js site (planned) |
| `apps/playground` | Dev playground: two-player board (M2) and analysis board (M3) (`pnpm --filter playground dev`) |
| `packages/bots` | Bot personalities and move choice (M4) |
| `packages/lessons` | Lesson format, step logic, content validator (M5) |
| `content/` | Lessons (11 units), bots; puzzles to come |
| `spikes/engine` | M0: engine size and speed comparison |

## Requirements

Node 24+ and pnpm (`corepack enable pnpm`).
