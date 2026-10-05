import { type CSSProperties, type KeyboardEvent, type PointerEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { type Color, type PieceType, Position, typeChar } from "xiangqi-core";
import { ALL_SQUARES, type Orientation, type Point, fromScreen, margin, toScreen, viewBox } from "./geometry.js";
import { PIECE_NAMES, PieceGlyph, type PieceSet } from "./pieces.js";
import { THEMES, type ThemeName } from "./themes.js";

export type ArrowColor = "green" | "red" | "blue" | "orange";
export interface Arrow {
  from: string;
  to: string;
  color?: ArrowColor;
}
export type HighlightKind = "hint" | "check" | "good" | "bad" | "selected" | "last";
export interface Highlight {
  square: string;
  kind: HighlightKind;
}
export type BadgeIcon = "brilliant" | "great" | "best" | "excellent" | "good" | "book" | "inaccuracy" | "mistake" | "miss" | "blunder";
export interface Badge {
  square: string;
  icon: BadgeIcon;
}

export interface XiangqiBoardProps {
  /** Position to show (standard Xiangqi FEN). */
  fen: string;
  /** Which side is at the bottom. */
  orientation?: Orientation;
  /** Which colour(s) the user may move; only the side to move in the FEN can actually move. */
  movable?: Color | "both" | "none";
  /** Legal moves in ICCS ("h2e2"), usually from xiangqi-core. Destinations not listed are illegal. */
  legalMoves?: readonly string[];
  /** Called with an ICCS move when the user makes a legal move. */
  onMove?: (move: string) => void;
  /** Called when the user drops or clicks a piece onto a square it cannot move to. */
  onIllegal?: (from: string, to: string) => void;
  /** Last move (ICCS) to highlight and animate. */
  lastMove?: string | null;
  /** Square of a general in check (pulses red). */
  check?: string | null;
  arrows?: readonly Arrow[];
  highlights?: readonly Highlight[];
  /** Move-quality icons shown on pieces (e.g. in game review). */
  badges?: readonly Badge[];
  pieceSet?: PieceSet;
  theme?: ThemeName;
  showCoordinates?: boolean;
  /** WXF: files 1–9 from each side's right. ICCS: files a–i and ranks 0–9. */
  coordinates?: "wxf" | "iccs";
  moveMethod?: "both" | "drag" | "click";
  showLegalMoves?: boolean;
  animation?: boolean;
  /** Allow right-click arrows and point marks drawn by the user. */
  drawable?: boolean;
  /** Text for screen readers, e.g. the last move in notation. */
  announce?: string;
  ariaLabel?: string;
  /**
   * Editing mode (e.g. a position editor): when set, clicks on points are reported here
   * instead of moving pieces. Right-clicks report "right".
   */
  onSquareClick?: (square: string, button: "left" | "right") => void;
  /** Gold stars on points (lesson "capture the star" challenges). */
  stars?: readonly string[];
}

const ARROW_COLORS: Record<ArrowColor, string> = {
  green: "rgba(20, 140, 60, 0.8)",
  red: "rgba(210, 40, 40, 0.8)",
  blue: "rgba(40, 110, 220, 0.8)",
  orange: "rgba(240, 140, 0, 0.85)",
};

const BADGES: Record<BadgeIcon, [string, string]> = {
  brilliant: ["!!", "#1baca6"],
  great: ["!", "#5b8bb0"],
  best: ["★", "#81b64c"],
  excellent: ["👍", "#81b64c"],
  good: ["✓", "#77915f"],
  book: ["B", "#a88865"],
  inaccuracy: ["?!", "#f0c15c"],
  mistake: ["?", "#e58f2a"],
  miss: ["×", "#ee6b55"],
  blunder: ["??", "#ca3431"],
};

const CN_FILES = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

interface Drag {
  from: string;
  start: Point;
  point: Point;
  active: boolean;
}

export function XiangqiBoard({
  fen,
  orientation = "red",
  movable = "both",
  legalMoves = [],
  onMove,
  onIllegal,
  lastMove = null,
  check = null,
  arrows = [],
  highlights = [],
  badges = [],
  pieceSet = "traditional",
  theme: themeName = "wood",
  showCoordinates = true,
  coordinates = "wxf",
  moveMethod = "both",
  showLegalMoves = true,
  animation = true,
  drawable = true,
  announce = "",
  ariaLabel = "Xiangqi board",
  onSquareClick,
  stars = [],
}: XiangqiBoardProps) {
  const theme = THEMES[themeName];
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [userArrows, setUserArrows] = useState<Arrow[]>([]);
  const [userMarks, setUserMarks] = useState<string[]>([]);
  const [drawFrom, setDrawFrom] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string>(orientation === "red" ? "e0" : "e9");
  // The cursor box shows only while the keyboard is being used (not after mouse clicks).
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [liveText, setLiveText] = useState("");
  const draggedMove = useRef<string | null>(null);

  const position = useMemo(() => Position.fromFen(fen), [fen]);
  const turn: Color = position.turn === 1 ? "red" : "black";
  const pieces = useMemo(() => {
    const out: { square: string; color: Color; type: PieceType }[] = [];
    position.board.forEach((code, i) => {
      if (code !== 0) out.push({ square: ALL_SQUARES[i]!, color: code > 0 ? "red" : "black", type: typeChar(code) });
    });
    return out;
  }, [position]);
  const pieceAt = (square: string) => pieces.find((p) => p.square === square) ?? null;

  const canMoveColor = (c: Color) => c === turn && (movable === "both" || movable === c);
  const destinationsFrom = (from: string) => legalMoves.filter((m) => m.slice(0, 2) === from).map((m) => m.slice(2));

  // A new position clears any selection.
  useEffect(() => {
    setSelected(null);
    setDrag(null);
  }, [fen]);

  // Clicking-to-move is off in drag-only mode, dragging is off in click-only mode.
  const allowClick = moveMethod !== "drag";
  const allowDrag = moveMethod !== "click";

  const describe = (square: string) => {
    const p = pieceAt(square);
    return p ? `${square}, ${p.color === "red" ? "Red" : "Black"} ${PIECE_NAMES[p.type]}` : `${square}, empty`;
  };

  const tryMove = (from: string, to: string, viaDrag: boolean) => {
    if (from === to) return;
    const move = from + to;
    if (legalMoves.includes(move)) {
      draggedMove.current = viaDrag ? move : null;
      setSelected(null);
      onMove?.(move);
    } else {
      setSelected(null);
      onIllegal?.(from, to);
    }
  };

  // --- Pointer input -----------------------------------------------------------

  const svgPoint = (e: PointerEvent): Point | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM?.();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  };
  // Prefer the hit target under the pointer (works without layout, e.g. in tests), else geometry.
  const squareAt = (e: PointerEvent): string | null => {
    const el = (e.target as Element | null)?.closest?.("[data-square]");
    if (el) return el.getAttribute("data-square");
    const p = svgPoint(e);
    return p ? fromScreen(p, orientation) : null;
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    setKeyboardMode(false);
    const square = squareAt(e);
    if (onSquareClick) {
      if (square && (e.button === 0 || e.button === 2)) onSquareClick(square, e.button === 2 ? "right" : "left");
      return;
    }
    if (e.button === 2) {
      if (drawable && square) setDrawFrom(square);
      return;
    }
    if (e.button !== 0) return;
    setUserArrows([]);
    setUserMarks([]);
    if (!square) {
      setSelected(null);
      return;
    }
    const p = pieceAt(square);
    if (selected && square !== selected && !(p && p.color === pieceAt(selected)?.color)) {
      if (allowClick) tryMove(selected, square, false);
      return;
    }
    if (p && canMoveColor(p.color)) {
      setSelected(square);
      if (allowDrag) {
        const pt = svgPoint(e) ?? toScreen(square, orientation);
        setDrag({ from: square, start: pt, point: pt, active: false });
        svgRef.current?.setPointerCapture?.(e.pointerId);
      }
    } else {
      setSelected(null);
    }
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const pt = svgPoint(e);
    if (!pt) return;
    const moved = Math.hypot(pt.x - drag.start.x, pt.y - drag.start.y) > 0.15;
    setDrag({ ...drag, point: pt, active: drag.active || moved });
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) {
      const to = squareAt(e);
      if (drawable && drawFrom && to) {
        if (to === drawFrom) setUserMarks((m) => (m.includes(to) ? m.filter((s) => s !== to) : [...m, to]));
        else {
          const color: ArrowColor = e.shiftKey ? "red" : e.altKey ? "blue" : "green";
          setUserArrows((a) => {
            const rest = a.filter((x) => !(x.from === drawFrom && x.to === to));
            return rest.length < a.length ? rest : [...a, { from: drawFrom, to, color }];
          });
        }
      }
      setDrawFrom(null);
      return;
    }
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.active) return; // a click: keep the selection for click-click moves
    const p = svgPoint(e);
    const to = p ? fromScreen(p, orientation) : squareAt(e);
    if (to && to !== d.from) tryMove(d.from, to, true);
  };

  // --- Keyboard input ------------------------------------------------------------

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    setKeyboardMode(true);
    const { x, y } = toScreen(cursor, orientation);
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = step[e.key];
    if (dir) {
      e.preventDefault();
      const next = fromScreen({ x: Math.min(8, Math.max(0, x + dir[0])), y: Math.min(9, Math.max(0, y + dir[1])) }, orientation);
      if (next) {
        setCursor(next);
        setLiveText(describe(next));
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (onSquareClick) {
        onSquareClick(cursor, "left");
        return;
      }
      const p = pieceAt(cursor);
      if (selected && cursor !== selected && !(p && p.color === pieceAt(selected)?.color)) {
        tryMove(selected, cursor, false);
      } else if (p && canMoveColor(p.color)) {
        setSelected(cursor);
        const n = destinationsFrom(cursor).length;
        setLiveText(`Selected ${describe(cursor)}. ${n} legal ${n === 1 ? "move" : "moves"}.`);
      }
      return;
    }
    if (e.key === "Escape") {
      setSelected(null);
      setLiveText("Selection cleared");
    }
  };

  // --- Rendering -------------------------------------------------------------------

  const flipped = orientation === "black";
  const m = margin(showCoordinates);
  const lineProps = { stroke: theme.line, strokeWidth: theme.lineWidth, strokeLinecap: "square" as const };
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let y = 0; y <= 9; y++) lines.push({ x1: 0, y1: y, x2: 8, y2: y });
  for (let x = 0; x <= 8; x++) {
    if (x === 0 || x === 8) lines.push({ x1: x, y1: 0, x2: x, y2: 9 });
    else {
      lines.push({ x1: x, y1: 0, x2: x, y2: 4 });
      lines.push({ x1: x, y1: 5, x2: x, y2: 9 });
    }
  }
  // Palace diagonals (symmetric, so orientation doesn't matter).
  lines.push({ x1: 3, y1: 0, x2: 5, y2: 2 }, { x1: 5, y1: 0, x2: 3, y2: 2 }, { x1: 3, y1: 7, x2: 5, y2: 9 }, { x1: 5, y1: 7, x2: 3, y2: 9 });

  // Small corner marks on cannon and soldier start points.
  const markPoints: Point[] = [
    ...[1, 7].flatMap((x) => [{ x, y: 2 }, { x, y: 7 }]),
    ...[0, 2, 4, 6, 8].flatMap((x) => [{ x, y: 3 }, { x, y: 6 }]),
  ];
  const marks = markPoints.flatMap(({ x, y }) =>
    [-1, 1].flatMap((sx) =>
      [-1, 1]
        .filter(() => (sx === -1 ? x > 0 : x < 8))
        .map((sy) => {
          const ax = x + sx * 0.1;
          const ay = y + sy * 0.1;
          return `M${ax + sx * 0.18},${ay}H${ax}V${ay + sy * 0.18}`;
        }),
    ),
  );

  const lastFrom = lastMove ? lastMove.slice(0, 2) : null;
  const lastTo = lastMove ? lastMove.slice(2, 4) : null;
  const dests = selected && showLegalMoves ? destinationsFrom(selected) : [];
  const animateMove = animation && lastMove && draggedMove.current !== lastMove ? lastMove : null;
  const allArrows = [...arrows, ...userArrows];
  const highlightColor: Record<HighlightKind, string> = {
    hint: theme.hint,
    check: theme.check,
    good: theme.good,
    bad: theme.bad,
    selected: theme.selected,
    last: theme.lastMove,
  };

  const coordLabels = () => {
    if (!showCoordinates) return null;
    const style = { fontSize: 0.32, fill: theme.coordinate, textAnchor: "middle" as const, dominantBaseline: "central" as const };
    const out = [];
    for (let x = 0; x <= 8; x++) {
      const file = flipped ? 8 - x : x; // a=0 … i=8
      if (coordinates === "iccs") {
        out.push(<text key={`f${x}`} x={x} y={9.78} {...style}>{"abcdefghi"[file]}</text>);
      } else {
        // Bottom side counts from its right; top side from its right (our left).
        const bottomRed = !flipped;
        const bottomNum = 9 - x;
        const topNum = x + 1;
        out.push(
          <text key={`b${x}`} x={x} y={9.78} {...style}>
            {bottomRed ? CN_FILES[bottomNum] : String(bottomNum)}
          </text>,
          <text key={`t${x}`} x={x} y={-0.78} {...style}>
            {bottomRed ? String(topNum) : CN_FILES[topNum]}
          </text>,
        );
      }
    }
    if (coordinates === "iccs") {
      for (let y = 0; y <= 9; y++) out.push(<text key={`r${y}`} x={-0.8} y={y} {...style}>{flipped ? y : 9 - y}</text>);
    }
    return out;
  };

  const arrowLine = (a: Arrow, i: number) => {
    const p1 = toScreen(a.from, orientation);
    const p2 = toScreen(a.to, orientation);
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (len === 0) return null;
    const ux = (p2.x - p1.x) / len;
    const uy = (p2.y - p1.y) / len;
    const color = a.color ?? "green";
    return (
      <line
        key={`a${i}`}
        x1={p1.x + ux * 0.25}
        y1={p1.y + uy * 0.25}
        x2={p2.x - ux * 0.3}
        y2={p2.y - uy * 0.3}
        stroke={ARROW_COLORS[color]}
        strokeWidth={0.13}
        strokeLinecap="round"
        markerEnd={`url(#${uid}-head-${color})`}
      />
    );
  };

  const cursorPt = toScreen(cursor, orientation);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg
        ref={svgRef}
        viewBox={viewBox(showCoordinates)}
        role="application"
        aria-label={ariaLabel}
        aria-roledescription="Xiangqi board"
        tabIndex={0}
        style={{ width: "100%", height: "auto", display: "block", touchAction: "none", userSelect: "none", outline: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
        onBlur={() => setKeyboardMode(false)}
      >
        <style>{`
          @keyframes ${uid}-slide { from { transform: translate(var(--dx), var(--dy)); } to { transform: translate(0, 0); } }
          @keyframes ${uid}-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.95; } }
          @media (prefers-reduced-motion: reduce) { .${uid}-anim { animation: none !important; } }
        `}</style>
        <defs>
          {(Object.keys(ARROW_COLORS) as ArrowColor[]).map((c) => (
            <marker key={c} id={`${uid}-head-${c}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse">
              <path d="M0,0L10,5L0,10z" fill={ARROW_COLORS[c]} />
            </marker>
          ))}
          <radialGradient id={`${uid}-check`}>
            <stop offset="0%" stopColor={theme.check} />
            <stop offset="100%" stopColor={theme.check} stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* Board */}
        <rect x={-m} y={-m} width={8 + 2 * m} height={9 + 2 * m} rx={0.15} fill={theme.board} />
        <g>
          {lines.map((l, i) => (
            <line key={i} {...l} {...lineProps} />
          ))}
          <rect x={-0.12} y={-0.12} width={8.24} height={9.24} fill="none" stroke={theme.line} strokeWidth={theme.lineWidth * 2} />
          <path d={marks.join("")} fill="none" stroke={theme.line} strokeWidth={theme.lineWidth} />
          <text x={2} y={4.5} fontSize={0.45} fill={theme.riverText} textAnchor="middle" dominantBaseline="central" fontFamily="'KaiTi','STKaiti','Noto Serif SC',serif" letterSpacing={0.4}>
            楚 河
          </text>
          <text x={6} y={4.5} fontSize={0.45} fill={theme.riverText} textAnchor="middle" dominantBaseline="central" fontFamily="'KaiTi','STKaiti','Noto Serif SC',serif" letterSpacing={0.4}>
            汉 界
          </text>
        </g>
        {coordLabels()}

        {/* Square highlights */}
        {[lastFrom, lastTo].map(
          (s, i) => s && <circle key={`l${i}`} {...ptAttrs(toScreen(s, orientation))} r={0.52} fill={theme.lastMove} />,
        )}
        {highlights.map((h, i) => (
          <circle key={`h${i}`} {...ptAttrs(toScreen(h.square, orientation))} r={0.47} fill={highlightColor[h.kind]} />
        ))}
        {userMarks.map((s) => (
          <circle key={`m${s}`} {...ptAttrs(toScreen(s, orientation))} r={0.46} fill="none" stroke={ARROW_COLORS.green} strokeWidth={0.07} />
        ))}
        {selected && <circle {...ptAttrs(toScreen(selected, orientation))} r={0.5} fill={theme.selected} />}
        {check && (
          <circle
            className={`${uid}-anim`}
            {...ptAttrs(toScreen(check, orientation))}
            r={0.62}
            fill={`url(#${uid}-check)`}
            style={{ animation: `${uid}-pulse 1.2s ease-in-out infinite` }}
          />
        )}

        {/* Stars */}
        {stars.map((s) => {
          const { x, y } = toScreen(s, orientation);
          return (
            <g key={`star-${s}`} transform={`translate(${x} ${y})`} style={{ pointerEvents: "none" }} data-star={s}>
              <path
                d="M0,-0.36L0.106,-0.146L0.342,-0.111L0.171,0.056L0.212,0.291L0,0.18L-0.212,0.291L-0.171,0.056L-0.342,-0.111L-0.106,-0.146Z"
                fill="#f2c230"
                stroke="#a87b00"
                strokeWidth={0.03}
              />
            </g>
          );
        })}

        {/* Pieces */}
        {pieces.map((p) => {
          if (drag?.active && drag.from === p.square) return null;
          const { x, y } = toScreen(p.square, orientation);
          const sliding = animateMove && p.square === lastTo;
          const from = sliding ? toScreen(lastFrom!, orientation) : null;
          return (
            <g key={sliding ? `${p.square}-${animateMove}` : p.square} transform={`translate(${x} ${y})`} style={{ pointerEvents: "none" }}>
              <g
                className={`${uid}-anim`}
                style={
                  from
                    ? ({
                        "--dx": `${from.x - x}px`,
                        "--dy": `${from.y - y}px`,
                        animation: `${uid}-slide 180ms ease-out`,
                      } as CSSProperties)
                    : undefined
                }
              >
                <PieceGlyph type={p.type} color={p.color} set={pieceSet} theme={theme} forwardUp={(p.color === "red") !== flipped} />
              </g>
            </g>
          );
        })}

        {/* Selection ring drawn above the piece so it stays visible */}
        {selected && (
          <circle {...ptAttrs(toScreen(selected, orientation))} r={0.49} fill="none" stroke={theme.cursor} strokeWidth={0.07} style={{ pointerEvents: "none" }} />
        )}

        {/* Badges */}
        {badges.map((b, i) => {
          const { x, y } = toScreen(b.square, orientation);
          const [label, color] = BADGES[b.icon];
          return (
            <g key={`b${i}`} transform={`translate(${x + 0.33} ${y - 0.33})`} style={{ pointerEvents: "none" }}>
              <circle r={0.2} fill={color} stroke="#fff" strokeWidth={0.03} />
              <text fontSize={0.2} fill="#fff" fontWeight={700} textAnchor="middle" dominantBaseline="central">
                {label}
              </text>
            </g>
          );
        })}

        {/* Legal destinations */}
        {dests.map((s) => {
          const pt = toScreen(s, orientation);
          return pieceAt(s) ? (
            <circle key={`d${s}`} {...ptAttrs(pt)} r={0.43} fill="none" stroke={theme.legal} strokeWidth={0.07} style={{ pointerEvents: "none" }} />
          ) : (
            <circle key={`d${s}`} {...ptAttrs(pt)} r={0.12} fill={theme.legal} style={{ pointerEvents: "none" }} />
          );
        })}

        {allArrows.map(arrowLine)}

        {/* Keyboard cursor */}
        {keyboardMode && (
          <rect x={cursorPt.x - 0.5} y={cursorPt.y - 0.5} width={1} height={1} rx={0.12} fill="none" stroke={theme.cursor} strokeWidth={0.06} />
        )}

        {/* Hit targets (topmost, invisible) */}
        <g>
          {ALL_SQUARES.map((s) => (
            <rect key={s} data-square={s} {...hitRect(toScreen(s, orientation))} fill="transparent" />
          ))}
        </g>

        {/* Dragged piece follows the pointer */}
        {drag?.active &&
          (() => {
            const p = pieceAt(drag.from);
            if (!p) return null;
            return (
              <g transform={`translate(${drag.point.x} ${drag.point.y}) scale(1.12)`} style={{ pointerEvents: "none" }}>
                <PieceGlyph type={p.type} color={p.color} set={pieceSet} theme={theme} forwardUp={(p.color === "red") !== flipped} />
              </g>
            );
          })()}
      </svg>
      <div aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {liveText || announce}
      </div>
    </div>
  );
}

const ptAttrs = (p: Point) => ({ cx: p.x, cy: p.y });
const hitRect = (p: Point) => ({ x: p.x - 0.5, y: p.y - 0.5, width: 1, height: 1 });
