import { type Progress, formatScore } from "@xq/engine";
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
  const head =
    status === "loading"
      ? "Loading engine…"
      : status === "error"
        ? `Engine unavailable: ${error}`
        : !enabled
          ? "Engine off"
          : gameOver
            ? "Game over in this position"
            : progress
              ? `Fairy-Stockfish · depth ${progress.depth} · ${Math.round(progress.nps / 1000)}k nodes/s`
              : "Thinking…";
  return (
    <section className="engine" aria-label="Engine analysis">
      <div className="engine-head">
        <label className="switch">
          <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} /> Engine
        </label>
        <span className="engine-status">{head}</span>
        <select value={multipv} onChange={(e) => onMultipv(Number(e.target.value))} aria-label="Number of lines">
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "line" : "lines"}
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
