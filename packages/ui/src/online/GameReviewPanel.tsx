"use client";
// Game Review after an online game (M18): this browser analyses every position with the site's
// engine (one thread, fixed depth, so the numbers match the opponent's browser), then shows both
// sides' accuracy and the player's move grades. For a rated game it also sends the analysis to
// the server, which compares it with the other browser's for the fair-play check.
import { type MoveGrade, type PositionEval, accuracy, analysePositions, gradeCounts, reviewFromEvals } from "@xq/engine";
import { type AnalysisData, FAIRPLAY_DEPTH, FAIRPLAY_LINES, encodeScore } from "@xq/online";
import { useEffect, useMemo, useState } from "react";
import { Game, isBookMove } from "xiangqi-core";
import { useAccount } from "../account/session.js";
import { useEngineInstance } from "../bots/useEngineInstance.js";
import { useT } from "../settings.js";
import { submitAnalysis } from "./api.js";

const GRADES: { grade: MoveGrade; en: string; zh: string }[] = [
  { grade: "best", en: "Best", zh: "最佳" },
  { grade: "excellent", en: "Excellent", zh: "好棋" },
  { grade: "good", en: "Good", zh: "不错" },
  { grade: "inaccuracy", en: "Inaccuracy", zh: "欠准" },
  { grade: "mistake", en: "Mistake", zh: "失误" },
  { grade: "blunder", en: "Blunder", zh: "败着" },
];
/** Games (and sides) already sent from this browser, so a revisit doesn't send them again. */
const SENT = "xq:fairplay-sent";

const sent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(SENT) ?? "[]") as string[];
  } catch {
    return [];
  }
};

export default function GameReviewPanel({ id, me, moves, rated }: { id: string; me: "red" | "black"; moves: readonly string[]; rated: boolean }) {
  const { tt } = useT();
  const account = useAccount();
  const { engine, status } = useEngineInstance(moves.length > 0);
  const [progress, setProgress] = useState(0);
  const [evals, setEvals] = useState<PositionEval[] | null>(null);
  const fens = useMemo(() => {
    const g = new Game();
    const out = [g.fen];
    for (const m of moves) {
      g.move(m);
      out.push(g.fen);
    }
    return out;
  }, [moves]);

  useEffect(() => {
    if (!engine || evals) return;
    let live = true;
    void analysePositions(engine, fens, { depth: FAIRPLAY_DEPTH, multipv: FAIRPLAY_LINES, onProgress: (done) => live && setProgress(done) }).then((e) => {
      if (live) setEvals(e);
    });
    return () => {
      live = false;
    };
  }, [engine]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sent once both the analysis and the server's word that the game was rated are in (either may come first).
  useEffect(() => {
    const key = `${id}:${me}`;
    if (!evals || !rated || sent().includes(key)) return;
    const data: AnalysisData = { v: 1, depth: FAIRPLAY_DEPTH, positions: evals.map((p) => ({ b: p.best, s: p.scores.map(encodeScore) })) };
    void account
      .client()
      .then((sb) => submitAnalysis(sb, id, data))
      .then(() => {
        try {
          localStorage.setItem(SENT, JSON.stringify([...sent().slice(-50), key]));
        } catch {}
      })
      .catch(() => {});
  }, [evals, rated, id, me, account]);

  if (moves.length === 0) return null;
  if (status === "error") return <p className="muted small">{tt("Game Review needs a browser that can run the engine.", "复盘需要能运行引擎的浏览器。")}</p>;
  if (!evals) {
    return (
      <p className="muted small" role="status">
        {tt(`Reviewing the game… ${progress} of ${fens.length}`, `正在复盘… ${progress}/${fens.length}`)}
      </p>
    );
  }
  const review = reviewFromEvals(fens, [...moves], evals, { isBook: (i) => isBookMove(moves, i) });
  const mine = accuracy(review, me === "red");
  const theirs = accuracy(review, me !== "red");
  const counts = gradeCounts(review, me === "red");
  return (
    <section className="game-review" aria-label={tt("Game Review", "复盘")}>
      <h3>{tt("Game Review", "复盘")}</h3>
      <p>
        {tt("Accuracy", "准确度")}: <strong>{mine === null ? "–" : Math.round(mine)}</strong> {tt("you", "你")} · {theirs === null ? "–" : Math.round(theirs)} {tt("opponent", "对手")}
      </p>
      <ul className="grade-counts">
        {GRADES.map((g) => (
          <li key={g.grade} className={`grade-${g.grade}`}>
            {tt(g.en, g.zh)} <strong>{counts[g.grade]}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
