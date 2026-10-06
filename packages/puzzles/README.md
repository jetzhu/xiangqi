# @xq/puzzles

Puzzle format, judging, rating and selection, plus the offline tools that make the puzzle set.

## Format (`content/puzzles/puzzles.jsonl`, one JSON object per line)

```json
{"id":"5d526be629","fen":"…","solution":["c7e6"],"rating":750,"themes":["mateIn2","fork","chariot"],"source":"pikafish-selfplay"}
```

`fen` has the solver to move; `solution` alternates solver and opponent moves (ICCS), starting and
ending with the solver. On the last move of a mate puzzle any mating move is accepted. A
`stalemate` theme marks a 困毙 win (in Xiangqi a side with no legal move loses). Optional fields:
`name` (title of a classical composition) and `difficulty` (`{ D, level }`, see Grading).

## Levels and grading

The set (578 puzzles on 2026-10-06) is graded by `scripts/grade.mjs` on what makes a Xiangqi
tactic hard, following a coach's review: length counts, but quiet moves, sacrifices and
tempting wrong tries count more.

```
D = (solver moves − 1)
  + 2 per quiet solver move (no check, no capture), + 2 more if the first move is quiet
  + 1.5 per sacrifice (2 for a chariot)
  + 1 per decoy: a natural check or capture at the start that leaves the solver no longer winning (max 3)
  + 1 for a motif: discovered check, or a cannon screen made by the moving piece
  + 1 if the defender has 3+ replies somewhere;  − 1 if every move is a check with one reply
floors and caps: mate in 1 → Beginner; mate in 2–3 → at least Standard; mate in 4+ → at least Hard
rating seed = 600 + 100·D
```

| Level | D | Rating band | Puzzles | Mostly |
| --- | --- | --- | --- | --- |
| Beginner | < 2 | below 800 | 129 | mate in 1, win a piece in one move |
| Standard | 2–5 | 800–1199 | 222 | mates in 2–3 by checks, forks, short combinations |
| Hard | 5–8 | 1200–1599 | 126 | quiet moves or sacrifices, mates in 2–6 |
| Extra hard | ≥ 8 | 1600+ | 101 | classical compositions (mates in 3–6), long combinations |

The seeds are a first estimate; once accounts exist, solve results should recalibrate each
puzzle's rating (Glicko per attempt, as Lichess does).

## Sources

- Our own Pikafish self-play (`pikafish-selfplay`, `pikafish-selfplay-hard`): no third-party rights.
- 58 classical compositions from 适情雅趣 (1570) and 江湖 collections, start positions via
  [XiangqiBench](https://github.com/floatai/xiangqibench) (MIT, © 2026 FloatAI); solutions
  computed by our engine. See `content/puzzles/sources/README.md`.

## Making puzzles

```sh
# once: native Pikafish (see spikes/engine/build-pikafish.sh), then
pnpm --filter xiangqi-core build
node scripts/generate.mjs --games 2400 --workers 3 --seed 2026 --out new.jsonl           # easy–medium
node scripts/generate.mjs --hard --games 600 --workers 3 --seed 2027 --out new-hard.jsonl  # harder
node scripts/import-xiangqibench.mjs classical.jsonl   # classical compositions
node scripts/merge.mjs ../../content/puzzles/puzzles.jsonl ../../content/puzzles/puzzles.jsonl new.jsonl …
node scripts/verify.mjs 16 ../../content/puzzles/puzzles.jsonl   # drop what fails
node scripts/grade.mjs ../../content/puzzles/puzzles.jsonl
pnpm --filter @xq/content generate
```

`--hard` also mines the moment a forced mate in 2–7 appears, allows up to 7 solver moves and
skips one-movers. A mate counts as unique when no other move mates within one move as fast.
`merge.mjs` drops repeated positions and their left-right mirror images.

1. **Self-play** — Pikafish plays itself at low depth, sampling among its top 5 lines (and 3% random
   moves), so natural mistakes happen.
2. **Mining** — a move that turns a level position (≤ +1.0) into a clearly winning one (≥ +3.0) for the
   opponent marks a candidate.
3. **Solving** — each solver move must be the engine's best at depth 14 by ≥ 250 cp over the second best
   (or the only mate). The line ends at mate, or after material is won and still won after the reply.
4. **Rating** — replaced by `grade.mjs` (see Levels and grading).
5. **Mix** — only 30% of one-move "take the hanging piece" puzzles are kept.



## Rating

Glicko-1 with puzzles at a fixed RD of 80; new solvers start at 800 ± 200; one puzzle moves the rating
by at most 80. Rated training starts with 5 unrated warm-up mates. In a rated puzzle the first hint
counts as a failed attempt. Difficulty is "Match my rating" (near the solver's rating) or one level,
choosing within that level the puzzle nearest the solver's rating.
