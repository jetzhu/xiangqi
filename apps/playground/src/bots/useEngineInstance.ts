import { type XiangqiEngine, engineSupported, loadFairyStockfish } from "@xq/engine";
import { useEffect, useRef, useState } from "react";

export type InstanceStatus = "off" | "loading" | "ready" | "error";

/**
 * Load one engine instance once `enabled` becomes true; shut it down on unmount.
 * Safe under React StrictMode's mount → unmount → mount in development.
 */
export function useEngineInstance(enabled: boolean): { engine: XiangqiEngine | null; status: InstanceStatus; error: string | null } {
  const [engine, setEngine] = useState<XiangqiEngine | null>(null);
  const [status, setStatus] = useState<InstanceStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const loading = useRef<Promise<XiangqiEngine> | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Quit only if we're really gone (StrictMode remounts immediately).
      setTimeout(() => {
        if (!mounted.current) void loading.current?.then((e) => e.quit());
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (!enabled || loading.current) return;
    const support = engineSupported();
    if (!support.ok) {
      setStatus("error");
      setError(support.reason ?? "not supported");
      return;
    }
    setStatus("loading");
    loading.current = loadFairyStockfish({ threads: 1, hashMb: 16 });
    loading.current.then(
      (e) => {
        if (!mounted.current) return;
        setEngine(e);
        setStatus("ready");
      },
      (err: Error) => {
        if (!mounted.current) return;
        setStatus("error");
        setError(err.message);
      },
    );
  }, [enabled]);

  return { engine, status, error };
}
