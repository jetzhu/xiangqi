// Puzzle Rush, as on chess.com: solve as many as you can; puzzles get harder as you go and
// three wrong answers end the run. 3 minutes, 5 minutes, or Survival (no clock). Unrated.
import { usePuzzles } from "./data.js";
import { type Puzzle, goalOf, pickPuzzle, rushTarget } from "@xq/puzzles";
import { useEffect, useRef, useState } from "react";
import { Board } from "../Board.js";
import { useNav } from "../nav.js";
import { useOrientation, useSound, useT } from "../settings.js";
import { useStore } from "../store/index.js";
import type { RushMode } from "./modes.js";
import { useSolver } from "./useSolver.js";

const STRIKES = 3;
const MODE_MS: Record<RushMode, number | null> = { "3": 3 * 60_000, "5": 5 * 60_000, survival: null };

interface Run {
  mode: RushMode;
  n: number;
  score: number;
  strikes: number;
  missed: Puzzle[];
  seen: Set<string>;
  endsAt: number | null;
  over: boolean;
  newBest: boolean;
}

function PuzzleRushWith({ PUZZLES }: { PUZZLES: Puzzle[] }) {
  const { lang, tt } = useT();
  const nav = useNav();
  const store = useStore();
  const playSound = useSound();
  const [best, setBest] = useState<Partial<Record<RushMode, number>>>({});
  const [run, setRun] = useState<Run | null>(null);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [now, setNow] = useState(Date.now());
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => void store.rush.load().then(setBest), []); // eslint-disable-line react-hooks/exhaustive-deps

  const end = (r: Run) => {
    playSound("end");
    setRun({ ...r, over: true, newBest: false });
    void store.activity.record();
    void store.rush.save(r.mode, r.score).then((newBest) => {
      setRun((cur) => (cur && cur.over ? { ...cur, newBest } : cur));
      return store.rush.load().then(setBest);
    });
  };

  const start = (mode: RushMode) => {
    const ms = MODE_MS[mode];
    const r: Run = { mode, n: 0, score: 0, strikes: 0, missed: [], seen: new Set(), endsAt: ms ? Date.now() + ms : null, over: false, newBest: false };
    const p = pickPuzzle(PUZZLES, rushTarget(0), r.seen)!;
    r.seen.add(p.id);
    setRun(r);
    setPuzzle(p);
  };

  const solver = useSolver(puzzle, (solved) => {
    const r = runRef.current;
    if (!r || r.over || !puzzle) return;
    const next: Run = solved ? { ...r, score: r.score + 1 } : { ...r, strikes: r.strikes + 1, missed: [...r.missed, puzzle] };
    if (next.strikes >= STRIKES) return end(next);
    next.n = r.n + 1;
    const p = pickPuzzle(PUZZLES, rushTarget(next.n), next.seen)!;
    next.seen.add(p.id);
    setRun(next);
    // A short pause so the solver sees the last move land.
    setTimeout(() => setPuzzle(p), solved ? 300 : 600);
  });

  const orientation = useOrientation(solver.solverRed ? "red" : "black");

  // The clock.
  useEffect(() => {
    if (!run || run.over || !run.endsAt) return;
    const id = setInterval(() => {
      setNow(Date.now());
      const r = runRef.current;
      if (r && !r.over && r.endsAt && Date.now() >= r.endsAt) end(r);
    }, 250);
    return () => clearInterval(id);
  }, [run?.endsAt, run?.over]); // eslint-disable-line react-hooks/exhaustive-deps

  const modeName = (m: RushMode) => (m === "survival" ? tt("Survival", "生存") : tt(`${m} minutes`, `${m} 分钟`));

  if (!run) {
    return (
      <div className="rush-start panel">
        <h1>{tt("Puzzle Rush", "解题冲刺")}</h1>
        <p className="muted">
          {tt(
            "Solve as many puzzles as you can. They start easy and get harder. Three wrong answers end the run. Not rated.",
            "尽可能多地解题。题目由易到难，答错三次结束。不计分。",
          )}
        </p>
        <div className="rush-modes">
          {(["3", "5", "survival"] as RushMode[]).map((m) => (
            <button key={m} type="button" className="rush-mode" onClick={() => start(m)}>
              <strong>{modeName(m)}</strong>
              <span className="muted">
                {m === "survival" ? tt("no clock", "不限时") : tt("against the clock", "限时")} · {tt("best", "最高")} {best[m] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (run.over) {
    return (
      <div className="rush-start panel">
        <h1>{tt("Run over", "冲刺结束")}</h1>
        <p className="rush-score">
          {run.score} <span className="muted">{tt("solved", "道")}</span>
        </p>
        <p>{run.newBest ? <strong>{tt("New best!", "新纪录！")}</strong> : `${tt("Best", "最高")} (${modeName(run.mode)}): ${best[run.mode] ?? 0}`}</p>
        {run.missed.length > 0 && (
          <>
            <h2>{tt("Missed — see the solutions", "错题——查看答案")}</h2>
            <ul className="rush-missed">
              {run.missed.map((p) => (
                <li key={p.id}>
                  <a href={nav.href(`/analysis?fen=${encodeURIComponent(p.fen)}&moves=${p.solution.join(",")}`)}>
                    {goalOf(p)[lang]} · {p.rating}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="buttons">
          <button type="button" className="primary" onClick={() => start(run.mode)}>
            {tt("Play again", "再来一次")}
          </button>
          <button type="button" onClick={() => setRun(null)}>
            {tt("Change mode", "换模式")}
          </button>
        </div>
      </div>
    );
  }

  const left = run.endsAt ? Math.max(0, run.endsAt - now) : null;
  const solverColor = solver.solverRed ? "red" : "black";
  return (
    <div className="botgame">
      <div className="board-col">
        <Board
          fen={solver.fen}
          orientation={orientation}
          movable={solver.myTurn ? solverColor : "none"}
          legalMoves={solver.legalMoves}
          onMove={solver.onMove}
          lastMove={solver.lastMove}
          check={solver.checkSquare}
        />
      </div>
      <aside className="panel" data-puzzle={puzzle?.id}>
        <div className="rush-bar">
          <span className="rush-score">{run.score}</span>
          <span className="strikes" aria-label={tt(`${run.strikes} of ${STRIKES} wrong`, `答错 ${run.strikes}/${STRIKES}`)}>
            {Array.from({ length: STRIKES }, (_, i) => (
              <span key={i} className={i < run.strikes ? "strike hit" : "strike"} aria-hidden>
                ✕
              </span>
            ))}
          </span>
          {left !== null && (
            <span className={`clock${left < 30_000 ? " running" : ""}`}>
              {Math.floor(left / 60_000)}:{String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}
            </span>
          )}
        </div>
        {puzzle && (
          <div className={`status ${solverColor}`} role="status">
            <span className="dot" aria-hidden />
            {solver.solverRed ? tt("Red to move", "红方走") : tt("Black to move", "黑方走")} · {goalOf(puzzle)[lang]}
          </div>
        )}
        <div className="buttons">
          <button type="button" onClick={() => end(run)}>
            {tt("End run", "结束")}
          </button>
        </div>
      </aside>
    </div>
  );
}

/** Waits for the puzzle set (loaded on first use), then shows PuzzleRush. */
export function PuzzleRush() {
  const puzzles = usePuzzles();
  const { tt } = useT();
  if (!puzzles) return <p className="muted" style={{ padding: 24 }}>{tt("Loading puzzles…", "正在加载题目…")}</p>;
  return <PuzzleRushWith PUZZLES={puzzles} />;
}
