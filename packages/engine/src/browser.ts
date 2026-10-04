// Load Fairy-Stockfish (WASM, pthreads) in the browser.
//
// Serve the files from the npm package "fairy-stockfish-nnue.wasm" (stockfish.js,
// stockfish.wasm, stockfish.worker.js) under `baseUrl`. The page must be cross-origin
// isolated (COOP: same-origin, COEP: require-corp or credentialless) for SharedArrayBuffer.
// The search runs in Emscripten's pthread workers, so the page's main thread stays free.

import { XiangqiEngine, type Transport } from "./engine.js";

interface FairyModule {
  postMessage(cmd: string): void;
  addMessageListener(cb: (line: string) => void): void;
  terminate(): void;
  FS: { writeFile(path: string, data: Uint8Array): void };
}
type FairyFactory = (opts: { locateFile: (f: string) => string }) => Promise<FairyModule>;

let scriptPromise: Promise<FairyFactory> | null = null;

function loadScript(src: string): Promise<FairyFactory> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => {
      const factory = (window as unknown as { Stockfish?: FairyFactory }).Stockfish;
      if (factory) resolve(factory);
      else reject(new Error("stockfish.js loaded but did not define Stockfish()"));
    };
    el.onerror = () => {
      scriptPromise = null;
      reject(new Error(`could not load ${src}`));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

export interface FairyOptions {
  /** URL of the folder holding stockfish.js, stockfish.wasm and stockfish.worker.js. */
  baseUrl?: string;
  /** Optional Xiangqi NNUE network URL (about 11 MB); classical evaluation if omitted. */
  nnueUrl?: string;
  /** Search threads (defaults to half the cores, at most 4). */
  threads?: number;
  /** Hash table size in MB. */
  hashMb?: number;
}

export function engineSupported(): { ok: boolean; reason?: string } {
  if (typeof WebAssembly === "undefined") return { ok: false, reason: "WebAssembly is not available" };
  if (typeof SharedArrayBuffer === "undefined" || !globalThis.crossOriginIsolated)
    return { ok: false, reason: "the page is not cross-origin isolated (COOP/COEP headers missing)" };
  return { ok: true };
}

/** Load Fairy-Stockfish and return a ready engine set to Xiangqi. */
export async function loadFairyStockfish(options: FairyOptions = {}): Promise<XiangqiEngine> {
  const support = engineSupported();
  if (!support.ok) throw new Error(`engine unavailable: ${support.reason}`);
  const base = (options.baseUrl ?? "/engine/fairy").replace(/\/$/, "");
  const factory = await loadScript(`${base}/stockfish.js`);
  const sf = await factory({ locateFile: (f) => `${base}/${f}` });

  const setup = ["setoption name UCI_Variant value xiangqi"];
  if (options.nnueUrl) {
    const res = await fetch(options.nnueUrl);
    if (!res.ok) throw new Error(`could not load network ${options.nnueUrl}: ${res.status}`);
    sf.FS.writeFile("/xiangqi.nnue", new Uint8Array(await res.arrayBuffer()));
    setup.push("setoption name EvalFile value /xiangqi.nnue", "setoption name Use NNUE value true");
  }
  const cores = navigator.hardwareConcurrency || 2;
  setup.push(`setoption name Threads value ${options.threads ?? Math.max(1, Math.min(4, Math.floor(cores / 2)))}`);
  setup.push(`setoption name Hash value ${options.hashMb ?? 32}`);

  const transport: Transport = {
    send: (c) => sf.postMessage(c),
    onLine: (cb) => sf.addMessageListener(cb),
    terminate: () => sf.terminate(),
  };
  return XiangqiEngine.create(transport, { coords: "fairy", setup });
}
