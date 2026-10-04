# @xq/board

The shared Xiangqi board for every page: a controlled React SVG component. It draws the
position it is given and reports what the user tried; rules stay in `xiangqi-core`.

```tsx
import { XiangqiBoard, playSound } from "@xq/board";
import { Game, toIccs, explainIllegal, parseSquare } from "xiangqi-core";

<XiangqiBoard
  fen={game.fen}
  legalMoves={game.legalMoves().map(toIccs)}
  onMove={(m) => { const r = game.move(m); if (r) playSound(r.captured ? "capture" : "move"); }}
  onIllegal={(from, to) => setMessage(explainIllegal(game.position(), parseSquare(from), parseSquare(to))?.en)}
  lastMove={game.history.at(-1)?.iccs}
/>
```

| Prop | Purpose |
| --- | --- |
| `fen`, `orientation`, `movable` | Position, which side is at the bottom, who may move |
| `legalMoves`, `onMove`, `onIllegal` | ICCS move list in, ICCS move out; illegal attempts reported with from/to |
| `lastMove`, `check`, `highlights`, `arrows`, `badges` | Last-move halo, pulsing check, hint/good/bad points, arrows, move-quality icons |
| `pieceSet` | `traditional` (帅仕相马车炮兵) or `icons` (shapes that hint at each piece's move) |
| `theme` | `wood`, `green`, `high-contrast` |
| `showCoordinates`, `coordinates` | WXF files 1–9 per side (Chinese numerals for Red) or ICCS a–i / 0–9 |
| `moveMethod`, `showLegalMoves`, `animation`, `drawable` | Drag/click, legal dots, slide animation, right-click arrows and marks |
| `announce`, `ariaLabel` | Screen-reader text |

Input: drag and drop, click-click, right-click drag for arrows (Shift = red, Alt = blue), right-click
for point marks, keyboard (arrow keys move a cursor, Enter selects/moves, Escape clears) with live
announcements. Honours `prefers-reduced-motion`. `playSound()` synthesizes move, capture, check,
illegal and end sounds with Web Audio (no audio files).

Demo: `pnpm --filter playground dev` → http://127.0.0.1:5173
