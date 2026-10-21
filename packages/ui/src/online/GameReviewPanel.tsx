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
import { useSettings, useT } from "../settings.js";
import type { Arrow } from "@xq/board";
import { EvalGraph, GRADE_COLOR, keyMoments } from "../review/EvalGraph.js";
import { submitAnalysis } from "./api.js";

const GRADES: { grade: MoveGrade; en: string; zh: string }[] = [
  { grade: "best", en: "Best", zh: "最佳" },
  { grade: "excellent", en: "Excellent", zh: "好棋" },
  { grade: "good", en: "Good", zh: "不错" },
  { grade: "inaccuracy", en: "Inaccuracy", zh: "欠准" },
  { grade: "mistake", en: "Mistake", zh: "失误" },
  { grade: "blunder", en: "Blunder", zh: "败着" },
];
const GRADE_NAME: Record<MoveGrade, { en: string; zh: string }> = {
  book: { en: "Book move", zh: "开局定式" },
  best: { en: "Best move", zh: "最佳着法" },
  excellent: { en: "Excellent", zh: "好棋" },
  good: { en: "Good", zh: "不错" },
  inaccuracy: { en: "Inaccuracy", zh: "欠准" },
  mistake: { en: "Mistake", zh: "失误" },
  miss: { en: "Miss", zh: "错失良机" },
  blunder: { en: "Blunder", zh: "败着" },
};
/** Games (and sides) already sent from this browser, so a revisit doesn't send them again. */
const SENT = "xq:fairplay-sent";

const sent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(SENT) ?? "[]") as string[];
  } catch {
    return [];
  }
};

/** `me`: the viewer's side, or null for someone who didn't play (both sides' accuracy, no grades). */
/** A key moment picked in the review: the board shows the position before that move, with the move played and the engine's choice. */
export interface ReviewFocusView {
  fen: string;
  arrows: Arrow[];
}

export default function GameReviewPanel({
  id,
  me,
  moves,
  rated,
  onFocus,
}: {
  id: string;
  me: "red" | "black" | null;
  moves: readonly string[];
  rated: boolean;
  /** Shows a picked moment on the game's board (null: back to the final position). */
  onFocus?: (f: ReviewFocusView | null) => void;
}) {
  const { tt } = useT();
  const notation = useSettings().settings.notation;
  const [focus, setFocus] = useState<number | null>(null);
  /** Whose moves the review looks at: the player's own by default, the opponent's on request. */
  const [side, setSide] = useState<"red" | "black">(me ?? "red");
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
    if (!evals || !rated || !me || sent().includes(key)) return;
    const data: AnalysisData = { v: 1, depth: FAIRPLAY_DEPTH, positions: evals.map((p) => ({ b: p.best, s: p.scores.map(encodeScore) })) };
    let live = true;
    void (async () => {
      // The server functions can be busy when many games end together: try again, waiting longer each time.
      for (const wait of [0, 3_000, 10_000, 30_000]) {
        await new Promise((r) => setTimeout(r, wait + Math.random() * 1_000));
        if (!live) return;
        try {
          await submitAnalysis(await account.client(), id, data);
          try {
            localStorage.setItem(SENT, JSON.stringify([...sent().slice(-50), key]));
          } catch {}
          return;
        } catch {
          // Busy or offline: the next try, or a later visit to this game, sends it.
        }
      }
    })();
    return () => {
      live = false;
    };
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
  const keys = keyMoments(review, side);
  const notate = (fen: string, iccs: string | null) => {
    if (!iccs) return null;
    const rec = new Game(fen).move(iccs);
    return rec ? (notation === "wxf" ? rec.wxf : notation === "iccs" ? rec.iccs : rec.chinese) : iccs;
  };
  const pick = (i: number | null) => {
    setFocus(i);
    if (i === null) return onFocus?.(null);
    const m = review[i]!;
    const arrows: Arrow[] = [{ from: m.move.slice(0, 2), to: m.move.slice(2, 4), color: "red" }];
    if (m.bestMove && m.bestMove !== m.move) arrows.push({ from: m.bestMove.slice(0, 2), to: m.bestMove.slice(2, 4), color: "green" });
    onFocus?.({ fen: fens[i]!, arrows });
  };
  const sel = focus === null ? null : review[focus]!;
  const mine = accuracy(review, (me ?? "red") === "red");
  const theirs = accuracy(review, (me ?? "red") !== "red");
  const counts = gradeCounts(review, side === "red");
  return (
    <section className="game-review" aria-label={tt("Game Review", "复盘")}>
      <h3>{tt("Game Review", "复盘")}</h3>
      <p>
        {tt("Accuracy", "准确度")}: <strong>{mine === null ? "–" : Math.round(mine)}</strong> {me ? tt("you", "你") : tt("Red", "红方")} · {theirs === null ? "–" : Math.round(theirs)}{" "}
        {me ? tt("opponent", "对手") : tt("Black", "黑方")}
      </p>
      <div className="segmented small" role="radiogroup" aria-label={tt("Review whose moves", "复盘哪一方")}>
        {(["red", "black"] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={side === c}
            className={side === c ? "selected" : ""}
            onClick={() => {
              setSide(c);
              pick(null);
            }}
          >
            {me ? (c === me ? tt("You", "你") : tt("Opponent", "对手")) : c === "red" ? tt("Red", "红方") : tt("Black", "黑方")}
          </button>
        ))}
      </div>
      <ul className="grade-counts">
        {GRADES.map((g) => (
          <li key={g.grade} className={`grade-${g.grade}`}>
            {tt(g.en, g.zh)} <strong>{counts[g.grade]}</strong>
          </li>
        ))}
      </ul>
      <EvalGraph
        reviewed={review}
        perspective={side}
        keys={keys}
        focusIndex={focus}
        onSelect={pick}
        label={
          me
            ? side === me
              ? tt("Your winning chances over the game", "你在整盘棋中的胜率变化")
              : tt("Your opponent's winning chances over the game", "对手在整盘棋中的胜率变化")
            : side === "red"
              ? tt("Red's winning chances over the game", "红方在整盘棋中的胜率变化")
              : tt("Black's winning chances over the game", "黑方在整盘棋中的胜率变化")
        }
      />
      {keys.length === 0 ? (
        <p className="muted small">{me && side === me ? tt("No inaccuracies, mistakes or blunders. Well played!", "没有欠准、失误或败着。下得好！") : tt("No inaccuracies, mistakes or blunders.", "没有欠准、失误或败着。")}</p>
      ) : (
        <ol className="key-list">
          {keys.map((k) => (
            <li key={k.index} className={focus === k.index ? "selected" : ""}>
              <button type="button" className="link" onClick={() => pick(focus === k.index ? null : k.index)}>
                <span className="dot" style={{ background: GRADE_COLOR[k.grade] }} aria-hidden /> {Math.floor(k.index / 2) + 1}
                {k.index % 2 ? "…" : "."} {notate(fens[k.index]!, k.move)}: {tt(GRADE_NAME[k.grade].en, GRADE_NAME[k.grade].zh)}
              </button>
            </li>
          ))}
        </ol>
      )}
      {sel && (
        <p className="small" role="status">
          {sel.bestMove && sel.bestMove !== sel.move
            ? tt(`Best was ${notate(fens[focus!]!, sel.bestMove)} (green arrow).`, `最佳着法是 ${notate(fens[focus!]!, sel.bestMove)}（绿色箭头）。`)
            : ""}{" "}
          <button type="button" className="link" onClick={() => pick(null)}>
            {tt("Final position", "终局")}
          </button>
        </p>
      )}
    </section>
  );
}
