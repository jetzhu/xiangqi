import { type PieceSet, type ThemeName, XiangqiBoard, playSound } from "@xq/board";
import { useMemo, useState } from "react";
import { Game, type MoveRecord, explainIllegal, parseSquare, squareName, toIccs } from "xiangqi-core";

type Notation = "wxf" | "chinese" | "iccs";
type Lang = "en" | "zh";

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
  },
} as const;

export function App() {
  const [game, setGame] = useState(() => new Game());
  const [version, setVersion] = useState(0); // bump to re-render after mutating `game`
  const [orientation, setOrientation] = useState<"red" | "black">("red");
  const [pieceSet, setPieceSet] = useState<PieceSet>("traditional");
  const [theme, setTheme] = useState<ThemeName>("wood");
  const [coords, setCoords] = useState<"wxf" | "iccs" | "off">("wxf");
  const [method, setMethod] = useState<"both" | "drag" | "click">("both");
  const [notation, setNotation] = useState<Notation>("chinese");
  const [lang, setLang] = useState<Lang>("zh");
  const [sound, setSound] = useState(true);
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

  const onMove = (move: string) => {
    const r = game.move(move);
    if (!r) return;
    setMessage(null);
    refresh();
    if (sound) playSound(game.result ? "end" : r.check ? "check" : r.captured ? "capture" : "move");
  };

  const onIllegal = (from: string, to: string) => {
    const why = explainIllegal(game.position(), parseSquare(from), parseSquare(to));
    setMessage(why ? why[lang] : null);
    if (sound && why) playSound("illegal");
  };

  const notate = (r: MoveRecord) => (notation === "wxf" ? r.wxf : notation === "chinese" ? r.chinese : r.iccs);

  const rows: [MoveRecord, MoveRecord | undefined][] = [];
  const firstIsBlack = history[0]?.color === "black";
  const list = firstIsBlack ? [undefined, ...history] : history;
  for (let i = 0; i < list.length; i += 2) rows.push([list[i] as MoveRecord, list[i + 1]]);

  const status = game.result
    ? game.result.text[lang]
    : `${game.turn === "red" ? t.red : t.black} ${t.toMove}${inCheck ? ` · ${t.check}` : ""}`;

  return (
    <main className="layout">
      <section className="board-col">
        <XiangqiBoard
          fen={game.fen}
          orientation={orientation}
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
          announce={last ? `${last.color === "red" ? "Red" : "Black"} ${last.wxf}` : ""}
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
            }}
          >
            {t.newGame}
          </button>
          <button onClick={() => setOrientation((o) => (o === "red" ? "black" : "red"))}>{t.flip}</button>
        </div>

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
            Language
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
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
