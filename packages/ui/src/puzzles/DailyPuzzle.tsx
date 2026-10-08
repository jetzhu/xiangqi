// The daily puzzle: the same for everyone today, unrated, retry as often as you like.
import { type Arrow, type Highlight } from "@xq/board";
import { type Puzzle, dailyPuzzle, goalOf } from "@xq/puzzles";
import { usePuzzles } from "./data.js";
import { useEffect, useMemo, useState } from "react";
import { Board } from "../Board.js";
import { useNav } from "../nav.js";
import { useOrientation, useT } from "../settings.js";
import { useStore } from "../store/index.js";
import { dayOf } from "../streak.js";
import { useSolver } from "./useSolver.js";

function DailyPuzzleWith({ PUZZLES }: { PUZZLES: Puzzle[] }) {
  const { lang, tt } = useT();
  const nav = useNav();
  const store = useStore();
  const today = dayOf(new Date());
  const puzzle = useMemo(() => dailyPuzzle(PUZZLES, today), [today]);
  const [solvedDays, setSolvedDays] = useState<string[]>([]);
  const [phase, setPhase] = useState<"solving" | "solved" | "failed">("solving");
  const [hint, setHint] = useState(0);
  useEffect(() => void store.daily.load().then(setSolvedDays), [store]);

  const solver = useSolver(puzzle, (solved) => {
    if (solved) {
      setPhase("solved");
      void store.daily.mark(today).then(setSolvedDays);
      void store.activity.record();
    } else setPhase("failed");
  });
  useEffect(() => setHint(0), [solver.fen]);

  const orientation = useOrientation(solver.solverRed ? "red" : "black");
  if (!puzzle) return null;
  const solverColor = solver.solverRed ? "red" : "black";
  const solving = phase === "solving";
  const arrows: Arrow[] = solving && hint >= 2 && solver.nextMove ? [{ from: solver.nextMove.slice(0, 2), to: solver.nextMove.slice(2, 4), color: "green" }] : [];
  const highlights: Highlight[] = solving && hint >= 1 && solver.nextMove ? [{ square: solver.nextMove.slice(0, 2), kind: "hint" }] : [];
  // The last 14 days, oldest first.
  const recent = Array.from({ length: 14 }, (_, i) => dayOf(new Date(Date.now() - (13 - i) * 864e5)));

  return (
    <div className="botgame">
      <div className="board-col">
        <Board
          fen={solver.fen}
          orientation={orientation}
          movable={solving && solver.myTurn ? solverColor : "none"}
          legalMoves={solving ? solver.legalMoves : []}
          onMove={solver.onMove}
          lastMove={solver.lastMove}
          check={solver.checkSquare}
          arrows={arrows}
          highlights={highlights}
        />
      </div>
      <aside className="panel">
        <h1>{tt("Daily puzzle", "每日一题")}</h1>
        <p className="muted">
          {new Date().toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { year: "numeric", month: "long", day: "numeric" })} ·{" "}
          {tt("the same puzzle for everyone today, not rated", "今天所有人同一道题，不计分")}
        </p>
        <div className={`status ${solverColor}`} role="status">
          <span className="dot" aria-hidden />
          {solver.solverRed ? tt("Red to move", "红方走") : tt("Black to move", "黑方走")} · {goalOf(puzzle)[lang]}
        </div>
        {phase === "solved" && <div className="say ok">{tt("Solved! A new puzzle comes at midnight.", "解开了！午夜更新下一题。")}</div>}
        {phase === "failed" && <div className="say bad">{tt("Not the best move.", "不是最佳着法。")}</div>}
        <div className="buttons">
          {solving && (
            <button type="button" onClick={() => setHint((h) => Math.min(2, h + 1))}>
              {hint === 0 ? tt("Hint", "提示") : tt("More hint", "再提示")}
            </button>
          )}
          {phase === "failed" && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                solver.reset();
                setPhase("solving");
              }}
            >
              {tt("Try again", "再试一次")}
            </button>
          )}
          {phase !== "solving" && (
            <a className="button" href={nav.href(`/analysis?fen=${encodeURIComponent(puzzle.fen)}&moves=${puzzle.solution.join(",")}`)}>
              {tt("Analyse", "分析")}
            </a>
          )}
        </div>
        <h2>{tt("Last 14 days", "最近 14 天")}</h2>
        <ol className="daily-calendar" aria-label={tt("Days the daily puzzle was solved", "已解出每日一题的日子")}>
          {recent.map((d) => (
            <li key={d} className={solvedDays.includes(d) ? "solved" : ""} title={d}>
              <span className="sr-only">
                {d}: {solvedDays.includes(d) ? tt("solved", "已解") : tt("not solved", "未解")}
              </span>
              {Number(d.slice(8))}
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

/** Waits for the puzzle set (loaded on first use), then shows DailyPuzzle. */
export function DailyPuzzle() {
  const puzzles = usePuzzles();
  const { tt } = useT();
  if (!puzzles) return <p className="muted" style={{ padding: 24 }}>{tt("Loading puzzles…", "正在加载题目…")}</p>;
  return <DailyPuzzleWith PUZZLES={puzzles} />;
}
