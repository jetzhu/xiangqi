// Post-game review: accuracy for both sides, an eval graph, and the player's key moments,
// each of which can be shown on the board or retried (as chess.com's Game Review does).
import { type MoveGrade, type ReviewedMove, accuracy } from "@xq/engine";
import type { Color, MoveRecord } from "xiangqi-core";
import type { Text } from "../settings.js";
import { useT } from "../settings.js";

import { EvalGraph, keyMoments } from "../review/EvalGraph.js";

export interface ReviewFocus {
  /** Index of the reviewed move; the board shows the position before it. */
  index: number;
  showBest: boolean;
  retry: boolean;
  /** Result of the last retry attempt. */
  verdict: "best" | "other" | null;
}

interface Props {
  reviewed: ReviewedMove[];
  history: readonly MoveRecord[];
  playerColor: Color;
  botName: string;
  gradeText: Record<MoveGrade, Text>;
  notate: (r: MoveRecord) => string;
  /** The engine's best move at `index`, in the user's notation. */
  bestText: (index: number) => string | null;
  focus: ReviewFocus | null;
  onFocus: (f: ReviewFocus | null) => void;
}

export function GameReview({ reviewed, history, playerColor, botName, gradeText, notate, bestText, focus, onFocus }: Props) {
  const { t, tt } = useT();
  const red = playerColor === "red";
  const mine = accuracy(reviewed, red);
  const theirs = accuracy(reviewed, !red);
  const keys = keyMoments(reviewed, playerColor);
  const keyPos = focus ? keys.findIndex((k) => k.index === focus.index) : -1;
  const go = (i: number) => onFocus({ index: i, showBest: false, retry: false, verdict: null });

  const moveNo = (i: number) => `${Math.floor(i / 2) + 1}${i % 2 ? "…" : "."}`;
  const sel = focus ? reviewed[focus.index] : undefined;
  const best = focus ? bestText(focus.index) : null;

  return (
    <section className="review" aria-label={tt("Game review", "复盘")}>
      <div className="accuracy">
        <div>
          <span className="muted">{tt("Your accuracy", "你的准确率")}</span>
          <strong>{mine === null ? "–" : mine.toFixed(1)}</strong>
        </div>
        <div>
          <span className="muted">{botName}</span>
          <strong>{theirs === null ? "–" : theirs.toFixed(1)}</strong>
        </div>
      </div>
      <EvalGraph
        reviewed={reviewed}
        perspective={playerColor}
        keys={keys}
        focusIndex={focus?.index ?? null}
        onSelect={go}
        label={tt("Your winning chances over the game", "你在整盘棋中的胜率变化")}
      />

      {keys.length === 0 ? (
        <p className="muted">{tt("No inaccuracies, mistakes or blunders. Well played!", "没有欠准、失误或败着。下得好！")}</p>
      ) : (
        <div className="key-moments">
          <div className="buttons">
            <button type="button" disabled={keyPos <= 0} onClick={() => go(keys[keyPos - 1]!.index)}>
              {tt("Previous", "上一个")}
            </button>
            <button type="button" className="primary" disabled={keyPos >= keys.length - 1} onClick={() => go(keys[keyPos + 1]!.index)}>
              {keyPos < 0 ? tt(`Key moments (${keys.length})`, `关键时刻（${keys.length}）`) : tt("Next key moment", "下一个关键时刻")}
            </button>
            {focus && (
              <button type="button" onClick={() => onFocus(null)}>
                {tt("Final position", "终局")}
              </button>
            )}
          </div>
          {sel && focus && (
            <div className={`moment g-${sel.grade}`}>
              <p>
                {moveNo(sel.index)} {tt("You played", "你走了")} <strong>{notate(history[sel.index]!)}</strong>: {t(gradeText[sel.grade])}.
                {focus.showBest && best && (
                  <>
                    {" "}
                    {tt("Best was", "最佳是")} <strong>{best}</strong>.
                  </>
                )}
              </p>
              {focus.retry && (
                <p className="muted">
                  {focus.verdict === "best"
                    ? tt("That's the best move!", "正是最佳着法！")
                    : focus.verdict === "other"
                      ? tt("Not the best move. Try again.", "不是最佳着法，再试一次。")
                      : tt("Find a better move on the board.", "在棋盘上找出更好的一步。")}
                </p>
              )}
              <div className="buttons">
                <button type="button" onClick={() => onFocus({ ...focus, retry: true, verdict: null })}>
                  {tt("Retry", "重走")}
                </button>
                <button type="button" onClick={() => onFocus({ ...focus, showBest: true })}>
                  {tt("Show best", "看最佳")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
