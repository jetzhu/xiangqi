import { type Arrow, type Badge, type BadgeIcon, EvalBar, type Highlight } from "@xq/board";
import { type BotConfig, type ChatEvent, type Text, chatLine, chooseMove } from "@xq/bots";
import { type MoveGrade, type Score, formatScore, gradeCounts, gradeMove, reviewGame, scoreToBar } from "@xq/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Color,
  Game,
  type MoveRecord,
  Position,
  explainIllegal,
  isBookMove,
  openingOf,
  parseSquare,
  squareName,
  toIccs,
} from "xiangqi-core";
import { Avatar } from "./Avatar.js";
import type { GameSettings, Lang } from "./BotPicker.js";
import { addCrown } from "./crowns.js";
import { useEngineInstance } from "./useEngineInstance.js";
import { Board } from "../Board.js";
import { useNav } from "../nav.js";
import { useSettings, useSound } from "../settings.js";

const other = (c: Color): Color => (c === "red" ? "black" : "red");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GRADE_TEXT: Record<MoveGrade, Text> = {
  book: { en: "Book move", zh: "开局定式" },
  best: { en: "Best move", zh: "最佳着法" },
  excellent: { en: "Excellent", zh: "好棋" },
  good: { en: "Good", zh: "不错" },
  inaccuracy: { en: "Inaccuracy", zh: "欠准" },
  mistake: { en: "Mistake", zh: "失误" },
  blunder: { en: "Blunder", zh: "败着" },
};
const CLOCKS: Record<string, { base: number; inc: number }> = {
  "10": { base: 10 * 60_000, inc: 0 },
  "15+10": { base: 15 * 60_000, inc: 10_000 },
  "30": { base: 30 * 60_000, inc: 0 },
};

interface Over {
  winner: Color | null;
  text: Text;
}
interface CoachEval {
  score: Score;
  best: string | null;
  done: boolean;
}

interface Props {
  bot: BotConfig;
  playerColor: Color;
  settings: GameSettings;
  lang: Lang;
  onExit: () => void;
  onRematch: () => void;
}

export function BotGame({ bot, playerColor, settings, lang, onExit, onRematch }: Props) {
  const playSound = useSound();
  const nav = useNav();
  const notation = useSettings().settings.notation;
  const t = (x: Text) => x[lang];
  const tt = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const a = settings.assists;
  const needCoach = a.evalBar || a.hint || a.threats || a.suggestions || a.feedback;
  const botEng = useEngineInstance(true);
  const coachEng = useEngineInstance(needCoach);

  const gameRef = useRef<Game>(new Game());
  const game = gameRef.current;
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const [chat, setChat] = useState<Text | null>(() => chatLine(bot, "greet"));
  const [over, setOver] = useState<Over | null>(null);
  const [thinking, setThinking] = useState(false);
  const [hintStep, setHintStep] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const coach = useRef(new Map<string, CoachEval>());
  const [coachTick, setCoachTick] = useState(0);
  const [threat, setThreat] = useState<{ fen: string; move: string } | null>(null);
  const [feedback, setFeedback] = useState<{ square: string; grade: MoveGrade } | null>(null);
  const pendingFeedback = useRef<{ prevFen: string; fen: string; square: string; moverIsRed: boolean; move: string; index: number } | null>(null);
  const clockCfg = CLOCKS[settings.time];
  const [clock, setClock] = useState<Record<Color, number> | null>(() => (clockCfg ? { red: clockCfg.base, black: clockCfg.base } : null));
  const [review, setReview] = useState<{ done: number; total: number; counts?: Record<MoveGrade, number> } | null>(null);

  const fen = game.fen;
  const turn = game.turn;
  const history = game.history;
  const botColor = other(playerColor);
  // Bot games always start from the standard position, so the opening book and names apply.
  const standard = true;
  const moves = history.map((r) => r.iccs);
  const opening = standard ? openingOf(moves) : null;
  const position = useMemo(() => Position.fromFen(fen), [fen]);
  const inCheck = game.isCheck();
  const checkSquare = inCheck ? squareName(position.kings[position.turn === 1 ? 0 : 1]) : null;

  const say = (ev: ChatEvent) => {
    const line = chatLine(bot, ev);
    if (line) setChat(line);
  };

  const finish = useCallback(
    (result: Over) => {
      setOver((prev) => prev ?? result);
      setThinking(false);
      playSound("end");
      say(result.winner === null ? "draw" : result.winner === playerColor ? "lose" : "win");
      if (result.winner === playerColor) void addCrown(bot.id);
    },
    [bot, playerColor], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const afterMove = (rec: MoveRecord, who: "bot" | "player") => {
    playSound(rec.check ? "check" : rec.captured ? "capture" : "move");
    if (who === "bot") {
      if (rec.check) say("botCheck");
      else if (rec.captured) say("botCapture");
    } else if (rec.captured) say("lostPiece");
    if (clockCfg && clockCfg.inc) setClock((c) => (c ? { ...c, [rec.color]: c[rec.color] + clockCfg.inc } : c));
    setHintStep(0);
    setThreat(null);
    setMessage(null);
    bump();
  };

  // Game over from the rules (mate, stalemate, repetition, move limit).
  useEffect(() => {
    if (!over && game.result) finish({ winner: game.result.winner, text: game.result.text });
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  // The bot's move.
  useEffect(() => {
    const engine = botEng.engine;
    if (!engine || over || game.result || turn !== botColor) return;
    let cancelled = false;
    setThinking(true);
    const t0 = performance.now();
    const posFen = fen;
    engine
      .analyze(posFen, { depth: bot.strength.depth, multipv: bot.strength.multipv })
      .then(async (r) => {
        if (cancelled) return;
        const choice = chooseMove({ bot, fen: posFen, lines: r.lines, history: standard ? moves : null });
        const wait = bot.strength.thinkMs - (performance.now() - t0);
        if (wait > 0) await sleep(wait);
        if (cancelled || !choice || game.fen !== posFen) return;
        const rec = game.move(choice.move);
        setThinking(false);
        if (rec) afterMove(rec, "bot");
      });
    return () => {
      cancelled = true;
      setThinking(false);
    };
  }, [version, botEng.engine, over]); // eslint-disable-line react-hooks/exhaustive-deps

  // Feedback on the player's last move: compare the evaluations before and after it. Runs
  // when the after-position's analysis finishes, or — if the bot replies first — with the
  // partial evaluation reached by then.
  const tryFeedback = () => {
    const pf = pendingFeedback.current;
    if (!pf) return;
    const before = coach.current.get(pf.prevFen);
    const after = coach.current.get(pf.fen);
    if (!before || !after) return;
    const g: MoveGrade =
      standard && isBookMove(moves.slice(0, pf.index + 1), pf.index)
        ? "book"
        : gradeMove(before.score, after.score, pf.moverIsRed, before.best === pf.move).grade;
    setFeedback({ square: pf.square, grade: g });
    pendingFeedback.current = null;
  };

  // Coach: evaluate every position (eval bar, hints, suggestions, feedback), then threats.
  useEffect(() => {
    const engine = coachEng.engine;
    if (!engine || over || game.result) return;
    tryFeedback();
    let cancelled = false;
    const posFen = fen;
    let last = 0;
    void (async () => {
      const r = await engine.analyze(posFen, { depth: 12 }, (p) => {
        const l = p.lines[0];
        if (!l || cancelled) return;
        coach.current.set(posFen, { score: l.score, best: l.pv[0] ?? null, done: false });
        if (performance.now() - last > 250) {
          last = performance.now();
          setCoachTick((x) => x + 1);
        }
      });
      if (cancelled) return;
      const l = r.lines[0];
      if (l) coach.current.set(posFen, { score: l.score, best: r.bestmove, done: true });
      setCoachTick((x) => x + 1);

      tryFeedback();

      // Threat: what the opponent would play if it were their move.
      if (a.threats && turn === playerColor && !inCheck) {
        const parts = posFen.split(" ");
        parts[1] = parts[1] === "b" ? "w" : "b";
        const flipped = parts.join(" ");
        const valid = (() => {
          try {
            return Position.fromFen(flipped).validate().length === 0;
          } catch {
            return false;
          }
        })();
        if (!valid) return;
        const tr = await engine.analyze(flipped, { depth: 8 });
        if (!cancelled && tr.bestmove) setThreat({ fen: posFen, move: tr.bestmove });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version, coachEng.engine, over]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clocks.
  useEffect(() => {
    if (!clock || over) return;
    let lastTs = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = now - lastTs;
      lastTs = now;
      setClock((c) => {
        if (!c) return c;
        const left = c[turn] - dt;
        if (left <= 0) {
          const loser = turn;
          setTimeout(() =>
            finish({
              winner: other(loser),
              text:
                loser === playerColor
                  ? { en: "You lost on time", zh: "你超时判负" }
                  : { en: `${bot.name.en} lost on time`, zh: `${bot.name.zh}超时判负` },
            }),
          );
          return { ...c, [turn]: 0 };
        }
        return { ...c, [turn]: left };
      });
    }, 200);
    return () => clearInterval(id);
  }, [turn, over, clock === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Post-game review with the (now idle) bot engine.
  useEffect(() => {
    const engine = botEng.engine;
    if (!over || !engine || review || history.length === 0) return;
    const fens = [new Game().fen, ...history.map((r) => r.fen)];
    setReview({ done: 0, total: fens.length });
    void reviewGame(engine, fens, moves, {
      depth: 8,
      isBook: (i) => standard && isBookMove(moves, i),
      onProgress: (done, total) => setReview((r) => (r && !r.counts ? { ...r, done, total } : r)),
    }).then((rev) => setReview({ done: fens.length, total: fens.length, counts: gradeCounts(rev, playerColor === "red") }));
  }, [over, botEng.engine]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Player actions -------------------------------------------------------------

  const onMove = (move: string) => {
    if (over || turn !== playerColor) return;
    const prevFen = game.fen;
    const rec = game.move(move);
    if (!rec) return;
    setFeedback(null);
    if (a.feedback)
      pendingFeedback.current = {
        prevFen,
        fen: game.fen,
        square: move.slice(2, 4),
        moverIsRed: playerColor === "red",
        move,
        index: game.history.length - 1,
      };
    afterMove(rec, "player");
  };

  const onIllegal = (from: string, to: string) => {
    const why = explainIllegal(position, parseSquare(from), parseSquare(to));
    if (why) {
      setMessage(why[lang]);
      playSound("illegal");
    }
  };

  const playerMoves = history.filter((r) => r.color === playerColor).length;
  const takeback = () => {
    if (!a.takeback || over || playerMoves === 0) return;
    let undonePlayer = false;
    while (game.history.length) {
      const r = game.undo()!;
      if (r.color === playerColor) undonePlayer = true;
      if (undonePlayer && game.turn === playerColor) break;
    }
    pendingFeedback.current = null;
    setFeedback(null);
    setHintStep(0);
    setThreat(null);
    setMessage(null);
    bump();
  };

  const resign = () => {
    if (!confirmResign) {
      setConfirmResign(true);
      return;
    }
    setConfirmResign(false);
    finish({ winner: botColor, text: { en: "You resigned", zh: "你认输了" } });
  };

  // --- Display ----------------------------------------------------------------------

  void coachTick;
  const evalNow = coach.current.get(fen);
  const myTurn = turn === playerColor && !over;
  const best = myTurn ? evalNow?.best ?? null : null;
  const arrows: Arrow[] = [];
  if (best && ((a.suggestions && evalNow?.done) || hintStep === 2)) arrows.push({ from: best.slice(0, 2), to: best.slice(2, 4), color: "green" });
  if (a.threats && threat && threat.fen === fen && myTurn) arrows.push({ from: threat.move.slice(0, 2), to: threat.move.slice(2, 4), color: "red" });
  const highlights: Highlight[] = hintStep === 1 && best ? [{ square: best.slice(0, 2), kind: "hint" }] : [];
  const badges: Badge[] = feedback ? [{ square: feedback.square, icon: feedback.grade as BadgeIcon }] : [];

  const fmtClock = (ms: number) => {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const rows: [MoveRecord | undefined, MoveRecord | undefined][] = [];
  const list = history[0]?.color === "black" ? [undefined, ...history] : history;
  for (let i = 0; i < list.length; i += 2) rows.push([list[i], list[i + 1]]);
  const analyseLink = nav.href(`/analysis${moves.length ? `?moves=${moves.join(",")}` : ""}`);
  const status =
    botEng.status === "error"
      ? tt(`Engine unavailable: ${botEng.error}`, `引擎不可用：${botEng.error}`)
      : botEng.status !== "ready"
        ? tt("Loading the engine…", "正在加载引擎…")
        : over
          ? t(over.text)
          : thinking
            ? tt(`${bot.name.en} is thinking…`, `${bot.name.zh}正在思考…`)
            : tt("Your move", "轮到你走") + (inCheck ? tt(" · Check!", " · 被将军！") : "");

  return (
    <div className="botgame">
      <div className="board-col">
        <div className="player-bar">
          <Avatar bot={bot} size={40} />
          <div className="who">
            <strong>{bot.name[lang]}</strong> <span className="bot-rating">{bot.ratingLabel}</span>
            {chat && <div className="bubble">{t(chat)}</div>}
          </div>
          {clock && <span className={`clock${turn === botColor && !over ? " running" : ""}`}>{fmtClock(clock[botColor])}</span>}
        </div>
        <div className={a.evalBar ? "board-wrap" : ""}>
          {a.evalBar && (
            <div className="evalbar">
              <EvalBar
                value={evalNow ? scoreToBar(evalNow.score) : 0}
                label={evalNow ? formatScore(evalNow.score) : ""}
                orientation={playerColor}
                pending={!evalNow}
              />
            </div>
          )}
          <Board
            fen={fen}
            orientation={playerColor}
            movable={myTurn ? playerColor : "none"}
            legalMoves={myTurn ? game.legalMoves().map(toIccs) : []}
            onMove={onMove}
            onIllegal={onIllegal}
            lastMove={history.at(-1)?.iccs ?? null}
            check={checkSquare}
            arrows={arrows}
            highlights={highlights}
            badges={badges}
            announce={history.at(-1) ? `${history.at(-1)!.color === playerColor ? "You" : bot.name.en}: ${history.at(-1)!.wxf}` : ""}
          />
        </div>
        <div className="player-bar">
          <span className="avatar you" style={{ width: 40, height: 40, background: playerColor === "red" ? "#c0262d" : "#1d1d1d" }} aria-hidden>
            {tt("You", "你")}
          </span>
          <div className="who">
            <strong>{tt("You", "你")}</strong> <span className="muted">({playerColor === "red" ? tt("Red", "红方") : tt("Black", "黑方")})</span>
          </div>
          {clock && <span className={`clock${turn === playerColor && !over ? " running" : ""}`}>{fmtClock(clock[playerColor])}</span>}
        </div>
      </div>

      <aside className="panel">
        <div className={`status ${over ? "over" : turn}`} role="status">
          <span className="dot" aria-hidden />
          {status}
        </div>
        {opening && <p className="opening">{t(opening)}</p>}
        {feedback && <div className={`feedback g-${feedback.grade}`}>{t(GRADE_TEXT[feedback.grade])}</div>}
        {message && <div className="message">{message}</div>}

        {!over && (
          <div className="buttons">
            {a.hint && (
              <button type="button" disabled={!myTurn || !best} onClick={() => setHintStep((s) => Math.min(2, s + 1))}>
                {hintStep === 0 ? tt("Hint", "提示") : tt("More hint", "再提示")}
              </button>
            )}
            {a.takeback && (
              <button type="button" disabled={playerMoves === 0} onClick={takeback}>
                {tt("Takeback", "悔棋")}
              </button>
            )}
            <button type="button" className={confirmResign ? "primary" : ""} onClick={resign} onBlur={() => setConfirmResign(false)}>
              {confirmResign ? tt("Confirm resign?", "确认认输？") : tt("Resign", "认输")}
            </button>
          </div>
        )}

        {over && (
          <section className="gameover" aria-label="Game over">
            <h2>{over.winner === null ? tt("Draw", "和棋") : over.winner === playerColor ? tt("You won!", "你赢了！") : tt(`${bot.name.en} won`, `${bot.name.zh}获胜`)}</h2>
            <p className="muted">{t(over.text)}</p>
            {review && !review.counts && (
              <p className="muted">
                {tt("Reviewing your moves…", "正在复盘你的着法…")} {review.done}/{review.total}
              </p>
            )}
            {review?.counts && (
              <table className="grades">
                <tbody>
                  {(Object.keys(GRADE_TEXT) as MoveGrade[]).map((g) => (
                    <tr key={g} className={`g-${g}`}>
                      <td>{t(GRADE_TEXT[g])}</td>
                      <td>{review.counts![g]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="buttons">
              <button type="button" className="primary" onClick={onRematch}>
                {tt("Rematch", "再来一局")}
              </button>
              <button type="button" onClick={onExit}>
                {tt("New bot", "换个对手")}
              </button>
              <a className="button" href={analyseLink}>
                {tt("Analyse", "分析棋局")}
              </a>
            </div>
          </section>
        )}

        <h2>{tt("Moves", "棋谱")}</h2>
        {rows.length === 0 ? (
          <p className="muted">{tt("No moves yet.", "尚未走棋。")}</p>
        ) : (
          <ol className="moves">
            {rows.map(([r, b], i) => (
              <li key={i}>
                <span className="num">{i + 1}.</span>
                <span className="mv">{r ? (notation === "wxf" ? r.wxf : notation === "iccs" ? r.iccs : r.chinese) : "…"}</span>
                <span className="mv">{b ? (notation === "wxf" ? b.wxf : notation === "iccs" ? b.iccs : b.chinese) : ""}</span>
              </li>
            ))}
          </ol>
        )}
        {!over && (
          <button type="button" className="link" onClick={onExit}>
            {tt("← Back to bots", "← 返回选择对手")}
          </button>
        )}
      </aside>
    </div>
  );
}
