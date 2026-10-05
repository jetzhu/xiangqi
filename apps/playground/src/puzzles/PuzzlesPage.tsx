import { type Arrow, type Highlight, XiangqiBoard, playSound } from "@xq/board";
import { type Puzzle, goalOf, judge, pickPuzzle, updateRating } from "@xq/puzzles";
import { useEffect, useMemo, useState } from "react";
import { Game, Position, explainIllegal, parseSquare, squareName, toIccs } from "xiangqi-core";
import puzzlesRaw from "../../../../content/puzzles/generated.jsonl?raw";
import { type PuzzleState, loadPuzzleState, savePuzzleState } from "./store.js";

type Lang = "en" | "zh";
const PUZZLES: Puzzle[] = puzzlesRaw
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Puzzle);
/** The first puzzles a new solver sees: the easiest mates in one. */
const ONBOARDING = PUZZLES.filter((p) => p.themes.includes("mateIn1"))
  .sort((a, b) => a.rating - b.rating)
  .slice(0, 5);

const THEME_NAMES: Record<string, [string, string]> = {
  mateIn1: ["Mate in 1", "一步杀"],
  mateIn2: ["Mate in 2", "两步杀"],
  mateIn3: ["Mate in 3", "三步杀"],
  advantage: ["Win material", "得子"],
  fork: ["Fork", "捉双"],
  sacrifice: ["Sacrifice", "弃子"],
  oneMove: ["One move", "一步"],
  short: ["Short", "短"],
  long: ["Long", "长"],
  chariot: ["Chariot", "车"],
  horse: ["Horse", "马"],
  cannon: ["Cannon", "炮"],
  soldier: ["Soldier", "兵"],
  general: ["General", "帅"],
  advisor: ["Advisor", "仕"],
  elephant: ["Elephant", "相"],
};

type Phase = "solving" | "solved" | "failed" | "review";

export function PuzzlesPage() {
  const [lang, setLang] = useState<Lang>("zh");
  const tt = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [state, setState] = useState<PuzzleState | null>(null);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [fen, setFen] = useState("");
  const [ply, setPly] = useState(0);
  const [lastMove, setLastMove] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("solving");
  const [rated, setRated] = useState(true);
  const [hint, setHint] = useState(0);
  const [say, setSay] = useState<string | null>(null);
  const [delta, setDelta] = useState<number | null>(null);

  useEffect(() => {
    void loadPuzzleState().then(setState);
  }, []);

  const start = (p: Puzzle, isRated: boolean) => {
    setPuzzle(p);
    setFen(p.fen);
    setPly(0);
    setLastMove(null);
    setPhase("solving");
    setRated(isRated);
    setHint(0);
    setSay(null);
    setDelta(null);
  };

  const next = (s: PuzzleState) => {
    const seen = new Set(s.history.map((h) => h.id));
    const onboarding = ONBOARDING.find((p) => !seen.has(p.id));
    // The first puzzles are a warm-up: easy mates in one, not rated.
    if (s.history.length < ONBOARDING.length && onboarding) start(onboarding, false);
    else {
      const p = pickPuzzle(PUZZLES, s.rating.rating, seen);
      if (p) start(p, true);
    }
  };

  useEffect(() => {
    if (state && !puzzle) next(state);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Record the attempt. A solve that used a hint is recorded but doesn't change the rating. */
  const finish = (score: 0 | 0.5 | 1) => {
    if (!state || !puzzle) return;
    const seenBefore = state.history.some((h) => h.id === puzzle.id);
    const counts = rated && score !== 0.5;
    const rating = counts ? updateRating(state.rating, puzzle.rating, score) : state.rating;
    if (seenBefore && !counts) return;
    const s: PuzzleState = {
      rating,
      history: [...state.history, { id: puzzle.id, score, ratingAfter: rating.rating, at: new Date().toISOString() }],
    };
    setDelta(counts ? rating.rating - state.rating.rating : null);
    setState(s);
    setRated(false);
    void savePuzzleState(s);
  };

  const solverRed = puzzle ? puzzle.fen.split(" ")[1] !== "b" : true;
  const solver = solverRed ? "red" : "black";
  const position = useMemo(() => (fen ? Position.fromFen(fen) : null), [fen]);
  const checkSq = position && position.isInCheck(position.turn) ? squareName(position.kings[position.turn === 1 ? 0 : 1]) : null;

  const onMove = (move: string) => {
    if (!puzzle || phase !== "solving") return;
    const verdict = judge(puzzle, ply, fen, move);
    const g = new Game(fen);
    const rec = g.move(move)!;
    playSound(rec.check ? "check" : rec.captured ? "capture" : "move");
    setFen(g.fen);
    setLastMove(move);
    if (verdict === "complete") {
      setPhase("solved");
      setSay(hint > 0 ? tt("Solved with a hint (not rated).", "借助提示解开（不计分）。") : tt("Solved!", "解开了！"));
      finish(hint > 0 ? 0.5 : 1);
      playSound("end");
    } else if (verdict === "correct") {
      setSay(tt("Correct — keep going.", "正确，继续。"));
      setHint(0);
      const reply = puzzle.solution[ply + 1]!;
      setTimeout(() => {
        const g2 = new Game(g.fen);
        const r2 = g2.move(reply)!;
        playSound(r2.check ? "check" : r2.captured ? "capture" : "move");
        setFen(g2.fen);
        setLastMove(reply);
        setPly(ply + 2);
      }, 500);
    } else {
      setPhase("failed");
      setSay(tt("Not the best move. Try again, or see the solution.", "不是最佳着法。再试一次，或查看答案。"));
      finish(0);
      playSound("illegal");
    }
  };

  const retry = () => {
    if (!puzzle) return;
    setFen(puzzle.fen);
    setPly(0);
    setLastMove(null);
    setPhase("solving");
    setHint(0);
    setSay(tt("Retry (not rated).", "重试（不计分）。"));
  };

  const showSolution = async () => {
    if (!puzzle) return;
    setPhase("review");
    const g = new Game(puzzle.fen);
    setFen(g.fen);
    for (const m of puzzle.solution) {
      await new Promise((r) => setTimeout(r, 700));
      g.move(m);
      setFen(g.fen);
      setLastMove(m);
    }
  };

  if (!state || !puzzle) return <p className="muted" style={{ padding: 24 }}>{tt("Loading puzzles…", "正在加载题目…")}</p>;

  const solverMove = puzzle.solution[ply];
  const arrows: Arrow[] = hint >= 2 && solverMove && phase === "solving" ? [{ from: solverMove.slice(0, 2), to: solverMove.slice(2, 4), color: "green" }] : [];
  const highlights: Highlight[] = hint >= 1 && solverMove && phase === "solving" ? [{ square: solverMove.slice(0, 2), kind: "hint" }] : [];
  const myTurn = phase === "solving" && position !== null && (position.turn === 1) === solverRed;
  const solved = state.history.filter((h) => h.score > 0).length;
  const analyseLink = `#/analysis?fen=${encodeURIComponent(puzzle.fen)}&moves=${puzzle.solution.join(",")}`;

  return (
    <div className="botgame">
      <div className="board-col">
        <XiangqiBoard
          fen={fen}
          orientation={solver}
          movable={myTurn ? solver : "none"}
          legalMoves={myTurn ? new Game(fen).legalMoves().map(toIccs) : []}
          onMove={onMove}
          onIllegal={(from, to) => {
            const why = position && explainIllegal(position, parseSquare(from), parseSquare(to));
            if (why) setSay(why[lang]);
          }}
          lastMove={lastMove}
          check={checkSq}
          arrows={arrows}
          highlights={highlights}
        />
      </div>
      <aside className="panel">
        <div className="puzzle-head">
          <div>
            <div className="muted">{tt("Puzzle rating", "解题等级分")}</div>
            <div className="big-rating">
              {state.rating.rating}
              {delta !== null && <span className={delta >= 0 ? "up" : "down"}>{delta >= 0 ? ` +${delta}` : ` ${delta}`}</span>}
            </div>
          </div>
          <div className="muted">
            {solved} {tt("solved", "道已解")}
          </div>
        </div>
        {!rated && phase === "solving" && state.history.length < ONBOARDING.length && (
          <p className="muted">
            {tt(`Warm-up ${state.history.length + 1}/${ONBOARDING.length} (not rated)`, `热身 ${state.history.length + 1}/${ONBOARDING.length}（不计分）`)}
          </p>
        )}
        <div className={`status ${solver}`} role="status">
          <span className="dot" aria-hidden />
          {solverRed ? tt("Red to move", "红方走") : tt("Black to move", "黑方走")} · {goalOf(puzzle)[lang]}
        </div>
        {say && <div className={`say ${phase === "solved" ? "ok" : phase === "failed" ? "bad" : ""}`}>{say}</div>}
        <div className="buttons">
          {phase === "solving" && (
            <button type="button" onClick={() => setHint((h) => Math.min(2, h + 1))}>
              {hint === 0 ? tt("Hint", "提示") : tt("More hint", "再提示")}
            </button>
          )}
          {phase === "failed" && (
            <>
              <button type="button" onClick={retry}>
                {tt("Retry", "重试")}
              </button>
              <button type="button" onClick={showSolution}>
                {tt("Show solution", "查看答案")}
              </button>
            </>
          )}
          {phase !== "solving" && (
            <>
              <button type="button" className="primary" onClick={() => next(state)}>
                {tt("Next puzzle", "下一题")}
              </button>
              <a className="button" href={analyseLink}>
                {tt("Analyse", "分析")}
              </a>
            </>
          )}
        </div>
        {phase !== "solving" && (
          <div className="themes">
            <span className="muted">
              {tt("Puzzle", "题目")} {puzzle.rating} ·{" "}
            </span>
            {puzzle.themes.map((t) => (
              <span key={t} className="chip">
                {THEME_NAMES[t]?.[lang === "zh" ? 1 : 0] ?? t}
              </span>
            ))}
          </div>
        )}
        <label className="lang">
          Language{" "}
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <p className="muted small">{tt(`${PUZZLES.length} puzzles, generated from engine self-play and checked by Pikafish.`, `共${PUZZLES.length}道题，由引擎自弈生成并经Pikafish验证。`)}</p>
      </aside>
    </div>
  );
}
