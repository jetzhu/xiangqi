import { type Progress, formatScore } from "@xq/engine";
import { useT } from "../settings.js";
import type { EngineStatus } from "./useEngine.js";
import { type NotationStyle, lineLabels } from "./notation.js";

interface Props {
  enabled: boolean;
  onToggle: (on: boolean) => void;
  status: EngineStatus;
  error: string | null;
  progress: Progress | null;
  fen: string;
  multipv: number;
  onMultipv: (n: number) => void;
  style: NotationStyle;
  /** Play the first `count` moves of line `index` into the tree. */
  onPlayLine: (pv: string[], count: number) => void;
  gameOver: boolean;
}

export function EnginePanel({ enabled, onToggle, status, error, progress, fen, multipv, onMultipv, style, onPlayLine, gameOver }: Props) {
  const { tt } = useT();
  const head =
    status === "loading"
      ? tt("Loading engine…", "正在加载引擎…")
      : status === "error"
        ? `${tt("Engine unavailable", "引擎不可用")}: ${error}`
        : !enabled
          ? tt("Engine off", "引擎已关闭")
          : gameOver
            ? tt("Game over in this position", "此局面已终局")
            : progress
              ? `Fairy-Stockfish · ${tt("depth", "深度")} ${progress.depth} · ${Math.round(progress.nps / 1000)}k ${tt("nodes/s", "节点/秒")}`
              : tt("Thinking…", "思考中…");
  return (
    <section className="engine" aria-label={tt("Engine analysis", "引擎分析")}>
      <div className="engine-head">
        <label className="switch">
          <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} /> {tt("Engine", "引擎")}
        </label>
        <span className="engine-status">{head}</span>
        <select value={multipv} onChange={(e) => onMultipv(Number(e.target.value))} aria-label={tt("Number of lines", "显示几条变化")}>
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n} {tt(n === 1 ? "line" : "lines", "条")}
            </option>
          ))}
        </select>
      </div>
      {enabled && !gameOver && (
        <ol className="lines">
          {Array.from({ length: multipv }, (_, i) => {
            const l = progress?.lines[i];
            if (!l) return <li key={i} className="line empty">…</li>;
            const labels = lineLabels(fen, l.pv, style).slice(0, 10);
            return (
              <li key={i} className="line">
                <span className={`score ${(l.score.mate ?? l.score.cp ?? 0) >= 0 ? "red" : "black"}`}>{formatScore(l.score)}</span>
                <span className="pv">
                  {labels.map((t, j) => (
                    <button key={j} type="button" className="pvmove" onClick={() => onPlayLine(l.pv, j + 1)}>
                      {t}
                    </button>
                  ))}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
