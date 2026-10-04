import { type Coords, type Score, fromIccs, parseBestMove, parseInfo, toIccs, toRedView } from "./uci.js";

/** Anything that carries UCI lines both ways (a WASM module, a Worker, a child process). */
export interface Transport {
  send(command: string): void;
  onLine(listener: (line: string) => void): void;
  terminate(): void;
}

export interface AnalysisLine {
  multipv: number;
  depth: number;
  /** Red's point of view. */
  score: Score;
  /** Principal variation in ICCS. */
  pv: string[];
}

export interface Progress {
  lines: AnalysisLine[];
  depth: number;
  nodes: number;
  nps: number;
}

export interface AnalyzeOptions {
  multipv?: number;
  depth?: number;
  movetime?: number;
  nodes?: number;
  /** Search until stop() if no limit is given. */
  infinite?: boolean;
}

export interface SearchResult {
  /** Best move in ICCS, or null if there is no legal move. */
  bestmove: string | null;
  lines: AnalysisLine[];
}

export interface EngineOptions {
  /** Coordinate system the engine speaks (Fairy-Stockfish: "fairy"). */
  coords: Coords;
  /** Commands sent after "uci", e.g. setting the variant. */
  setup?: string[];
}

interface Search {
  fenRedToMove: boolean;
  lines: Map<number, AnalysisLine>;
  onProgress: ((p: Progress) => void) | undefined;
  resolve: (r: SearchResult) => void;
  nodes: number;
  nps: number;
}

/**
 * A UCI Xiangqi engine. One search runs at a time: a new analyze() stops the previous
 * search first, so callers can fire requests freely while the user moves around.
 */
export class XiangqiEngine {
  private search: Search | null = null;
  private waiters: { test: (l: string) => boolean; resolve: () => void }[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private readonly coords: Coords;

  private constructor(
    private readonly transport: Transport,
    options: EngineOptions,
  ) {
    this.coords = options.coords;
    transport.onLine((line) => this.handle(line));
  }

  /** Connect to an engine and run the UCI handshake. */
  static async create(transport: Transport, options: EngineOptions): Promise<XiangqiEngine> {
    const e = new XiangqiEngine(transport, options);
    const uciok = e.waitFor((l) => l === "uciok");
    transport.send("uci");
    await uciok;
    for (const cmd of options.setup ?? []) transport.send(cmd);
    await e.ready();
    return e;
  }

  setOption(name: string, value: string | number | boolean): void {
    this.transport.send(`setoption name ${name} value ${value}`);
  }

  async ready(): Promise<void> {
    const p = this.waitFor((l) => l === "readyok");
    this.transport.send("isready");
    await p;
  }

  get busy(): boolean {
    return this.search !== null;
  }

  /** Analyse a position. `onProgress` receives every update; the promise resolves at bestmove. */
  analyze(fen: string, options: AnalyzeOptions = {}, onProgress?: (p: Progress) => void): Promise<SearchResult> {
    // Only starting a search is serialised (stop the old one, then start), not the whole
    // search; otherwise a request queued behind an infinite search would never run.
    const start = () => this.start(fen, options, onProgress);
    const started = this.queue.then(start, start);
    this.queue = started.then(
      () => undefined,
      () => undefined,
    );
    return started.then((s) => s.done);
  }

  private async start(
    fen: string,
    options: AnalyzeOptions,
    onProgress: ((p: Progress) => void) | undefined,
  ): Promise<{ done: Promise<SearchResult> }> {
    await this.stopCurrent();
    const { multipv = 1, depth, movetime, nodes } = options;
    this.setOption("MultiPV", multipv);
    this.transport.send("ucinewgame");
    await this.ready();
    const done = new Promise<SearchResult>((resolve) => {
      this.search = { fenRedToMove: fen.split(/\s+/)[1] !== "b", lines: new Map(), onProgress, resolve, nodes: 0, nps: 0 };
    });
    this.transport.send(`position fen ${fen}`);
    const limits = [
      depth !== undefined ? `depth ${depth}` : "",
      movetime !== undefined ? `movetime ${movetime}` : "",
      nodes !== undefined ? `nodes ${nodes}` : "",
    ].filter(Boolean);
    this.transport.send(limits.length ? `go ${limits.join(" ")}` : "go infinite");
    // Wrapped in an object so the caller's .then() doesn't wait for the search itself.
    return { done };
  }

  /** Stop the running search (its promise still resolves with what was found). */
  stop(): Promise<void> {
    return this.stopCurrent();
  }

  quit(): void {
    this.transport.send("quit");
    this.transport.terminate();
  }

  private async stopCurrent(): Promise<void> {
    if (!this.search) return;
    const done = this.waitFor((l) => l.startsWith("bestmove"));
    this.transport.send("stop");
    await done;
  }

  private waitFor(test: (l: string) => boolean): Promise<void> {
    return new Promise((resolve) => this.waiters.push({ test, resolve }));
  }

  private handle(line: string) {
    const s = this.search;
    if (s) {
      const info = parseInfo(line);
      if (info && info.pv.length && !info.bound) {
        s.lines.set(info.multipv, {
          multipv: info.multipv,
          depth: info.depth,
          score: toRedView(info.score, s.fenRedToMove),
          pv: info.pv.map((m) => toIccs(m, this.coords)),
        });
        s.nodes = info.nodes ?? s.nodes;
        s.nps = info.nps ?? s.nps;
        s.onProgress?.(this.progress(s));
      }
      const best = parseBestMove(line);
      if (best !== undefined) {
        this.search = null;
        s.resolve({ bestmove: best === null ? null : toIccs(best, this.coords), lines: this.progress(s).lines });
      }
    }
    for (const w of [...this.waiters]) {
      if (w.test(line)) {
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve();
      }
    }
  }

  private progress(s: Search): Progress {
    const lines = [...s.lines.values()].sort((a, b) => a.multipv - b.multipv);
    return { lines, depth: lines[0]?.depth ?? 0, nodes: s.nodes, nps: s.nps };
  }

  /** Convert an ICCS move list to the engine's coordinates (for "position … moves"). */
  toEngineMoves(moves: string[]): string[] {
    return moves.map((m) => fromIccs(m, this.coords));
  }
}
