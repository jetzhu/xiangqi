# @xq/puzzles

Puzzle format, judging, rating and selection, plus the offline tools that make the puzzle set.

## Format (`content/puzzles/generated.jsonl`, one JSON object per line)

```json
{"id":"5d526be629","fen":"…","solution":["c7e6"],"rating":750,"themes":["mateIn2","fork","chariot"],"source":"pikafish-selfplay"}
```

`fen` has the solver to move; `solution` alternates solver and opponent moves (ICCS), starting and
ending with the solver. On the last move of a mate puzzle any mating move is accepted.

## Making puzzles

```sh
# once: native Pikafish (see spikes/engine/build-pikafish.sh), then
pnpm --filter xiangqi-core build
node scripts/generate.mjs --games 2400 --workers 3 --seed 2026 --out ../../content/puzzles/generated.jsonl
node scripts/verify.mjs 16     # re-check every puzzle at depth 16
```

1. **Self-play** — Pikafish plays itself at low depth, sampling among its top 5 lines (and 3% random
   moves), so natural mistakes happen.
2. **Mining** — a move that turns a level position (≤ +1.0) into a clearly winning one (≥ +3.0) for the
   opponent marks a candidate.
3. **Solving** — each solver move must be the engine's best at depth 14 by ≥ 250 cp over the second best
   (or the only mate). The line ends at mate, or after material is won and still won after the reply.
4. **Rating** — `300 + 90 × (shallowest stable depth) + 230 × (extra solver moves) + 150 if the first move
   is quiet − 50 for mates`, clamped to 400–2400. A first estimate; calibrate with real solve data.
5. **Mix** — only 30% of one-move "take the hanging piece" puzzles are kept.

Puzzles come from our own engine games, so there are no third-party rights in them.

## Rating

Glicko-1 with puzzles at a fixed RD of 80; new solvers start at 800 ± 200; one puzzle moves the rating
by at most 80. The playground starts with 5 unrated warm-up mates; solves that used a hint are unrated.
