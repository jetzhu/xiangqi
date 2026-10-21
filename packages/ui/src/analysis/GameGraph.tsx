"use client";
// "Review the game" on the analysis board: analyses the main line once (its own engine, one
// thread, so the live analysis keeps running) and shows the evaluation graph with one side's key
// moments (the player's side from a game's link; switchable); a dot jumps to the position before
// that move.
import { type ReviewedMove, accuracy, analysePositions, reviewFromEvals } from "@xq/engine";
import { useEffect, useMemo, useState } from "react";
import { type GameTree, START_FEN, type TreeNode, isBookMove } from "xiangqi-core";
import { useEngineInstance } from "../bots/useEngineInstance.js";
import { EvalGraph, keyMoments } from "../review/EvalGraph.js";
import { useT } from "../settings.js";

const DEPTH = 10;

export function GameGraph({
  tree,
  current,
  onSelect,
  disabled,
  side,
  onSide,
}: {
  tree: GameTree;
  current: TreeNode;
  onSelect: (n: TreeNode) => void;
  disabled: boolean;
  /** Whose moves the review looks at. */
  side: "red" | "black";
  onSide: (s: "red" | "black") => void;
}) {
  const { tt } = useT();
  const line = tree.mainline();
  const moves = line.map((n) => n.move!.iccs);
  const key = `${tree.root.fen}|${moves.join(",")}`;
  const [asked, setAsked] = useState(false);
  const [done, setDone] = useState(0);
  const [result, setResult] = useState<{ key: string; review: ReviewedMove[] } | null>(null);
  const { engine, status } = useEngineInstance(asked && !disabled);
  const fens = useMemo(() => [tree.root.fen, ...line.map((n) => n.fen)], [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!asked || !engine || disabled || result?.key === key) return;
    let live = true;
    setDone(0);
    const standard = tree.root.fen === START_FEN;
    void analysePositions(engine, fens, { depth: DEPTH, onProgress: (d) => live && setDone(d) }).then((evals) => {
      if (live) setResult({ key, review: reviewFromEvals(fens, moves, evals, { isBook: (i) => standard && isBookMove(moves, i) }) });
    });
    return () => {
      live = false;
    };
  }, [asked, engine, key, disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (moves.length < 2) return null;
  if (disabled) return null;
  if (!asked) {
    return (
      <p>
        <button type="button" onClick={() => setAsked(true)}>
          {tt("Review the game", "复盘全局")}
        </button>
      </p>
    );
  }
  if (status === "error") return <p className="muted small">{tt("The engine can't run in this browser.", "此浏览器无法运行引擎。")}</p>;
  if (!result || result.key !== key) {
    return (
      <p className="muted small" role="status">
        {tt(`Reviewing the main line… ${done} of ${fens.length}`, `正在复盘主线… ${done}/${fens.length}`)}
      </p>
    );
  }
  const review = result.review;
  const red = accuracy(review, true);
  const black = accuracy(review, false);
  // The cursor marks the move that leads to the shown position, if it's on the main line.
  const at = line.indexOf(current);
  return (
    <section className="game-graph" aria-label={tt("Game graph", "局势曲线")}>
      <div className="segmented small" role="radiogroup" aria-label={tt("Review whose moves", "复盘哪一方")}>
        {(["red", "black"] as const).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={side === c} className={side === c ? "selected" : ""} onClick={() => onSide(c)}>
            {c === "red" ? tt("Red", "红方") : tt("Black", "黑方")}
          </button>
        ))}
      </div>
      <p className="small">
        {tt("Accuracy", "准确度")}: <strong>{red === null ? "–" : Math.round(red)}</strong> {tt("Red", "红方")} · <strong>{black === null ? "–" : Math.round(black)}</strong>{" "}
        {tt("Black", "黑方")}
      </p>
      <EvalGraph
        reviewed={review}
        perspective={side}
        keys={keyMoments(review, side)}
        focusIndex={at >= 0 ? at : null}
        onSelect={(i) => onSelect(i === 0 ? tree.root : line[i - 1]!)}
        label={side === "red" ? tt("Red's winning chances over the main line", "红方在主线中的胜率变化") : tt("Black's winning chances over the main line", "黑方在主线中的胜率变化")}
      />
      <p className="muted small">
        {side === "red"
          ? tt("Dots mark Red's inaccuracies, mistakes and blunders; click one to see the position before it.", "圆点标出红方的欠准、失误和败着；点击可查看该步之前的局面。")
          : tt("Dots mark Black's inaccuracies, mistakes and blunders; click one to see the position before it.", "圆点标出黑方的欠准、失误和败着；点击可查看该步之前的局面。")}
      </p>
    </section>
  );
}
