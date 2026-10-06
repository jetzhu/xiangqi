import { type PieceSet, type ThemeName } from "@xq/board";
import { useEffect, useMemo, useRef, useState } from "react";
import { Game, type MoveRecord, explainIllegal, parseSquare, squareName, toIccs } from "xiangqi-core";
import { Board } from "../Board.js";
import { type NotationStyle as Notation, announceMove, useSettings, useSound } from "../settings.js";

const T = {
  en: {
    title: "Xiangqi board demo",
    sub: "Two players on one screen. Drag or click to move; right-click to draw arrows.",
    red: "Red",
    black: "Black",
    toMove: "to move",
    check: "Check!",
    undo: "Undo",
    newGame: "New game",
    flip: "Flip board",
    sound: "Sound",
    notation: "Notation",
    pieces: "Pieces",
    theme: "Theme",
    coords: "Coordinates",
    method: "Move by",
    moves: "Moves",
    noMoves: "No moves yet.",
    fen: "Position (FEN)",
    load: "Load",
    badFen: "Could not load that position",
    autoFlip: "Flip after each move",
    clock: "Clock",
    noClock: "No clock",
    timeout: "ran out of time",
    wins: "wins",
  },
  zh: {
    title: "象棋棋盘演示",
    sub: "双人同屏对弈。拖动或点击走子；右键画箭头。",
    red: "红方",
    black: "黑方",
    toMove: "走棋",
    check: "将军！",
    undo: "悔棋",
    newGame: "新局",
    flip: "翻转棋盘",
    sound: "声音",
    notation: "记谱",
    pieces: "棋子",
    theme: "主题",
    coords: "坐标",
    method: "走子方式",
    moves: "棋谱",
    noMoves: "尚未走棋。",
    fen: "局面（FEN）",
    load: "载入",
    badFen: "无法载入该局面",
    autoFlip: "每步后翻转棋盘",
    clock: "计时",
    noClock: "不计时",
    timeout: "超时",
    wins: "胜",
  },
} as const;

/** Clock choices: base minutes and increment seconds per move. */
const CLOCKS = { none: null, "5": { base: 5, inc: 0 }, "10": { base: 10, inc: 0 }, "15+10": { base: 15, inc: 10 } } as const;
type ClockKey = keyof typeof CLOCKS;
const fmt = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

export function PlayPage() {
  const [game, setGame] = useState(() => new Game());
  const [version, setVersion] = useState(0); // bump to re-render after mutating `game`
  const [fixedOrientation, setOrientation] = useState<"red" | "black">("red");
  const [autoFlip, setAutoFlip] = useState(false);
  const [clockKey, setClockKey] = useState<ClockKey>("none");
  const [clock, setClock] = useState<{ red: number; black: number } | null>(null);
  /** The side whose time ran out. */
  const [flagged, setFlagged] = useState<"red" | "black" | null>(null);
  const lastTick = useRef(0);
  // The options on this page are the site settings, so changes here apply everywhere.
  const { settings, update } = useSettings();
  const { pieceSet, theme, notation, lang, sound } = settings;
  const coords = settings.coordinates;
  const method = settings.moveMethod;
  const setPieceSet = (pieceSet: PieceSet) => update({ pieceSet });
  const setTheme = (theme: ThemeName) => update({ theme });
  const setCoords = (coordinates: "wxf" | "iccs" | "off") => update({ coordinates });
  const setMethod = (moveMethod: "both" | "drag" | "click") => update({ moveMethod });
  const setNotation = (notation: Notation) => update({ notation });
  const setSound = (sound: boolean) => update({ sound });
  const playSound = useSound();
  const [message, setMessage] = useState<string | null>(null);
  const [fenInput, setFenInput] = useState("");
  const t = T[lang];

  const legalMoves = useMemo(() => game.legalMoves().map(toIccs), [game, version]);
  const history = game.history;
  const last = history.at(-1) ?? null;
  const inCheck = game.isCheck();
  const generalSquare = useMemo(() => {
    for (let s = 0; s < 90; s++) {
      const p = game.pieceAt(s);
      if (p?.type === "k" && p.color === game.turn) return squareName(s);
    }
    return null;
  }, [game, version]);

  const refresh = () => setVersion((v) => v + 1);
  const orientation = autoFlip ? game.turn : fixedOrientation;
  const cfg = CLOCKS[clockKey];

  const resetClock = (key: ClockKey) => {
    const c = CLOCKS[key];
    setClock(c ? { red: c.base * 60_000, black: c.base * 60_000 } : null);
    setFlagged(null);
  };

  // The side to move's clock runs from Red's first move until the game ends.
  useEffect(() => {
    if (!clock || flagged || game.result || history.length === 0) return;
    lastTick.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const spent = now - lastTick.current;
      lastTick.current = now;
      setClock((c) => {
        if (!c) return c;
        const left = Math.max(0, c[game.turn] - spent);
        if (left === 0) setFlagged(game.turn);
        return { ...c, [game.turn]: left };
      });
    }, 200);
    return () => clearInterval(id);
  }, [version, clock === null, flagged]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (move: string) => {
    if (flagged) return;
    const r = game.move(move);
    if (!r) return;
    if (cfg && cfg.inc) setClock((c) => (c ? { ...c, [r.color]: c[r.color] + cfg.inc * 1000 } : c));
    setMessage(null);
    refresh();
    playSound(game.result ? "end" : r.check ? "check" : r.captured ? "capture" : "move");
  };

  const onIllegal = (from: string, to: string) => {
    const why = explainIllegal(game.position(), parseSquare(from), parseSquare(to));
    setMessage(why ? why[lang] : null);
    if (why) playSound("illegal");
  };

  const notate = (r: MoveRecord) => (notation === "wxf" ? r.wxf : notation === "chinese" ? r.chinese : r.iccs);

  const rows: [MoveRecord, MoveRecord | undefined][] = [];
  const firstIsBlack = history[0]?.color === "black";
  const list = firstIsBlack ? [undefined, ...history] : history;
  for (let i = 0; i < list.length; i += 2) rows.push([list[i] as MoveRecord, list[i + 1]]);

  const status = flagged
    ? `${flagged === "red" ? t.red : t.black} ${t.timeout} · ${flagged === "red" ? t.black : t.red} ${t.wins}`
    : game.result
    ? game.result.text[lang]
    : `${game.turn === "red" ? t.red : t.black} ${t.toMove}${inCheck ? ` · ${t.check}` : ""}`;

  return (
    <main className="layout">
      <section className="board-col">
        <Board
          fen={game.fen}
          orientation={orientation}
          movable={flagged || game.result ? "none" : "both"}
          legalMoves={legalMoves}
          onMove={onMove}
          onIllegal={onIllegal}
          lastMove={last?.iccs ?? null}
          check={inCheck ? generalSquare : null}
          pieceSet={pieceSet}
          theme={theme}
          showCoordinates={coords !== "off"}
          coordinates={coords === "iccs" ? "iccs" : "wxf"}
          moveMethod={method}
          announce={last ? announceMove(last, notation, lang) : ""}
        />
      </section>

      <aside className="panel">
        <header>
          <h1>{t.title}</h1>
          <p className="sub">{t.sub}</p>
        </header>

        <div className={`status ${game.result ? "over" : game.turn}`} role="status">
          <span className="dot" aria-hidden />
          {status}
        </div>
        {message && <div className="message">{message}</div>}

        <div className="buttons">
          <button
            onClick={() => {
              game.undo();
              setMessage(null);
              refresh();
            }}
            disabled={history.length === 0}
          >
            {t.undo}
          </button>
          <button
            onClick={() => {
              setGame(new Game());
              setMessage(null);
              resetClock(clockKey);
            }}
          >
            {t.newGame}
          </button>
          <button onClick={() => setOrientation((o) => (o === "red" ? "black" : "red"))} disabled={autoFlip}>
            {t.flip}
          </button>
        </div>

        {clock && (
          <div className="play-clocks">
            {(["red", "black"] as const).map((c) => (
              <span key={c} className={`clock${game.turn === c && history.length > 0 && !flagged && !game.result ? " running" : ""}`}>
                {c === "red" ? t.red : t.black} {fmt(clock[c])}
              </span>
            ))}
          </div>
        )}

        <div className="options">
          <label>
            {t.notation}
            <select value={notation} onChange={(e) => setNotation(e.target.value as Notation)}>
              <option value="chinese">中文</option>
              <option value="wxf">WXF</option>
              <option value="iccs">ICCS</option>
            </select>
          </label>
          <label>
            {t.pieces}
            <select value={pieceSet} onChange={(e) => setPieceSet(e.target.value as PieceSet)}>
              <option value="traditional">汉字 / Characters</option>
              <option value="icons">Icons</option>
            </select>
          </label>
          <label>
            {t.theme}
            <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeName)}>
              <option value="wood">Wood</option>
              <option value="green">Green</option>
              <option value="high-contrast">High contrast</option>
              <option value="colorblind">Colour-blind safe</option>
            </select>
          </label>
          <label>
            {t.coords}
            <select value={coords} onChange={(e) => setCoords(e.target.value as "wxf")}>
              <option value="wxf">WXF 1–9</option>
              <option value="iccs">ICCS a–i</option>
              <option value="off">Off</option>
            </select>
          </label>
          <label>
            {t.method}
            <select value={method} onChange={(e) => setMethod(e.target.value as "both")}>
              <option value="both">Drag + click</option>
              <option value="drag">Drag</option>
              <option value="click">Click</option>
            </select>
          </label>
          <label>
            {t.clock}
            <select
              value={clockKey}
              onChange={(e) => {
                const k = e.target.value as ClockKey;
                setClockKey(k);
                resetClock(k);
              }}
            >
              <option value="none">{t.noClock}</option>
              <option value="5">5 min</option>
              <option value="10">10 min</option>
              <option value="15+10">15 + 10</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={autoFlip} onChange={(e) => setAutoFlip(e.target.checked)} /> {t.autoFlip}
          </label>
          <label className="check">
            <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> {t.sound}
          </label>
        </div>

        <h2>{t.moves}</h2>
        {rows.length === 0 ? (
          <p className="muted">{t.noMoves}</p>
        ) : (
          <ol className="moves">
            {rows.map(([r, b], i) => (
              <li key={i}>
                <span className="num">{i + 1}.</span>
                <span className="mv">{r ? notate(r) : "…"}</span>
                <span className="mv">{b ? notate(b) : ""}</span>
              </li>
            ))}
          </ol>
        )}

        <h2>{t.fen}</h2>
        <code className="fen">{game.fen}</code>
        <form
          className="fen-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              setGame(new Game(fenInput.trim()));
              setMessage(null);
            } catch (err) {
              setMessage(`${t.badFen}: ${(err as Error).message}`);
            }
          }}
        >
          <input value={fenInput} onChange={(e) => setFenInput(e.target.value)} placeholder="rnbakabnr/9/…" aria-label={t.fen} />
          <button type="submit">{t.load}</button>
        </form>
      </aside>
    </main>
  );
}
