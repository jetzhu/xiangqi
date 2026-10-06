// Post-game review: accuracy for both sides, an eval graph, and the player's key moments,
// each of which can be shown on the board or retried (as chess.com's Game Review does).
import { type MoveGrade, type ReviewedMove, accuracy, winChance } from "@xq/engine";
import type { Color, MoveRecord } from "xiangqi-core";
import type { Text } from "../settings.js";
import { useT } from "../settings.js";

const KEY_GRADES: MoveGrade[] = ["inaccuracy", "mistake", "miss", "blunder"];
const GRADE_COLOR: Partial<Record<MoveGrade, string>> = { inaccuracy: "#c99a1e", mistake: "#e58f2a", miss: "#d2683c", blunder: "#ca3431" };

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
  const keys = reviewed.filter((m) => m.moverIsRed === red && KEY_GRADES.includes(m.grade));
  const keyPos = focus ? keys.findIndex((k) => k.index === focus.index) : -1;
  const go = (i: number) => onFocus({ index: i, showBest: false, retry: false, verdict: null });

  // The graph: the player's win chance after each move, 0 at the bottom, 1 at the top.
  const W = 300;
  const H = 72;
  const n = Math.max(1, reviewed.length);
  const x = (i: number) => ((i + 1) / n) * W;
  const y = (m: ReviewedMove) => {
    const w = winChance(m.after);
    return (1 - (red ? w : 1 - w)) * H;
  };
  const path = `M0 ${H / 2} ${reviewed.map((m, i) => `L${x(i).toFixed(1)} ${y(m).toFixed(1)}`).join(" ")}`;
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
      <svg className="eval-graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={tt("Your winning chances over the game", "你在整盘棋中的胜率变化")}>
        <rect width={W} height={H} className="eval-bg" />
        <path d={`${path} L${W} ${H} L0 ${H} Z`} className="eval-area" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="eval-mid" />
        {focus && <line x1={x(focus.index)} x2={x(focus.index)} y1="0" y2={H} className="eval-cursor" />}
        {keys.map((k) => (
          <circle key={k.index} cx={x(k.index)} cy={y(k)} r="3.5" fill={GRADE_COLOR[k.grade]} onClick={() => go(k.index)} style={{ cursor: "pointer" }} />
        ))}
      </svg>

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
