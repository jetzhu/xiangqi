import { type Progress, type XiangqiEngine, engineSupported, loadFairyStockfish } from "@xq/engine";
import { useEffect, useRef, useState } from "react";

export type EngineStatus = "off" | "loading" | "ready" | "error";

export interface EngineView {
  status: EngineStatus;
  error: string | null;
  /** Latest progress for `fen` (null until the first update for this position). */
  progress: (Progress & { fen: string }) | null;
}

/**
 * Load Fairy-Stockfish on first use and analyse `fen` whenever it changes.
 * Updates are throttled to ~10 per second; results for old positions are dropped.
 */
export function useEngine(enabled: boolean, fen: string, multipv: number, depth: number): EngineView {
  const engine = useRef<XiangqiEngine | null>(null);
  const [status, setStatus] = useState<EngineStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<EngineView["progress"]>(null);

  // Load once, when first enabled.
  useEffect(() => {
    if (!enabled || engine.current || status === "loading") return;
    const support = engineSupported();
    if (!support.ok) {
      setStatus("error");
      setError(support.reason ?? "not supported");
      return;
    }
    setStatus("loading");
    loadFairyStockfish()
      .then((e) => {
        engine.current = e;
        setStatus("ready");
      })
      .catch((err: Error) => {
        setStatus("error");
        setError(err.message);
      });
  }, [enabled, status]);

  // Analyse the current position.
  useEffect(() => {
    const e = engine.current;
    if (!e || status !== "ready") return;
    if (!enabled) {
      void e.stop();
      return;
    }
    setProgress(null);
    let latest: Progress | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const flush = () => {
      timer = null;
      if (!cancelled && latest) setProgress({ ...latest, fen });
    };
    void e
      .analyze(fen, { multipv, depth }, (p) => {
        latest = p;
        timer ??= setTimeout(flush, 100);
      })
      .then(() => {
        if (timer) clearTimeout(timer);
        flush();
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [fen, enabled, multipv, depth, status]);

  // Free the engine when the page goes away.
  useEffect(() => () => engine.current?.quit(), []);

  return { status, error, progress: progress && progress.fen === fen ? progress : null };
}
