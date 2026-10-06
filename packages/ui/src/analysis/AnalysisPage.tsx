import { type Arrow, type ArrowColor, EvalBar } from "@xq/board";
import { formatScore, scoreToBar } from "@xq/engine";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GameTree, Position, START_FEN, type TreeNode, explainIllegal, parseSquare, squareName, toIccs } from "xiangqi-core";
import { EnginePanel } from "./EnginePanel.js";
import { MoveTreeView } from "./MoveTreeView.js";
import { PositionEditor } from "./PositionEditor.js";
import { type SavedAnalysis, deleteSaved, listSaved, saveAnalysis } from "./storage.js";
import { useEngine } from "./useEngine.js";
import { Board } from "../Board.js";
import { type Nav, useNav } from "../nav.js";
import { type NotationStyle, announceMove, useSettings, useSound, useT } from "../settings.js";

/** Read "?fen=…&moves=h2e2,h9g7" into a tree and the node at the end of the moves. */
function fromUrl(nav: Nav): { tree: GameTree; node: TreeNode } {
  const q = nav.params();
  let tree: GameTree;
  try {
    tree = new GameTree(q.get("fen") || START_FEN);
  } catch {
    tree = new GameTree();
  }
  let node = tree.root;
  for (const m of (q.get("moves") ?? "").split(",").filter(Boolean)) {
    const next = tree.play(node, m);
    if (!next) break;
    node = next;
  }
  return { tree, node };
}

/** App path for a position: "/analysis?fen=…&moves=…". */
function sharePath(tree: GameTree, node: TreeNode): string {
  const q = new URLSearchParams();
  if (tree.startFen !== new GameTree().startFen) q.set("fen", tree.startFen);
  const moves = tree.path(node).map((n) => n.move!.iccs);
  if (moves.length) q.set("moves", moves.join(","));
  return `/analysis${q.size ? `?${q}` : ""}`;
}

const LINE_COLORS: ArrowColor[] = ["green", "blue", "orange"];

export function AnalysisPage() {
  const nav = useNav();
  const playSound = useSound();
  const { settings, update } = useSettings();
  const { tt } = useT();
  const style = settings.notation;
  const setStyle = (notation: NotationStyle) => update({ notation });
  const [{ tree, node: initial }] = useState(() => fromUrl(nav));
  const [treeState, setTreeState] = useState({ tree, current: initial, version: 0 });
  const { current } = treeState;
  const [orientation, setOrientation] = useState<"red" | "black">("red");
  const [engineOn, setEngineOn] = useState(true);
  const [multipv, setMultipv] = useState(3);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [io, setIo] = useState("");
  const [saved, setSaved] = useState<SavedAnalysis[]>([]);
  const [title, setTitle] = useState("");

  const t = treeState.tree;
  const go = useCallback((n: TreeNode) => setTreeState((s) => ({ ...s, current: n })), []);
  const bump = (n: TreeNode) => setTreeState((s) => ({ ...s, current: n, version: s.version + 1 }));
  const replaceTree = (nt: GameTree, n: TreeNode = nt.root) => setTreeState((s) => ({ tree: nt, current: n, version: s.version + 1 }));

  const position = useMemo(() => Position.fromFen(current.fen), [current]);
  const legalMoves = useMemo(() => position.legalMoves().map(toIccs), [position]);
  const gameOver = legalMoves.length === 0;
  const inCheck = position.isInCheck(position.turn);
  const checkSquare = inCheck ? squareName(position.kings[position.turn === 1 ? 0 : 1]) : null;

  const engine = useEngine(engineOn && !editing && !gameOver, current.fen, multipv, 22);
  const best = engine.progress?.lines[0];
  const arrows: Arrow[] = engineOn
    ? (engine.progress?.lines ?? []).slice(0, multipv).flatMap((l, i) =>
        l.pv[0] ? [{ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), color: LINE_COLORS[i] ?? "green" }] : [],
      )
    : [];

  // Keep the share link in the address bar.
  useEffect(() => {
    nav.replace(sharePath(t, current));
  }, [t, current, treeState.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: ← → step, Home/End jump (not while typing or using the board's own cursor).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, svg[role=application]")) return;
      if (e.key === "ArrowLeft" && current.parent) go(current.parent);
      else if (e.key === "ArrowRight" && current.children[0]) go(current.children[0]);
      else if (e.key === "Home") go(t.root);
      else if (e.key === "End") go(t.mainline(current).at(-1) ?? current);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, go, t]);

  useEffect(() => {
    listSaved().then(setSaved, () => setSaved([]));
  }, []);

  const onMove = (move: string) => {
    const n = t.play(current, move);
    if (!n) return;
    setMessage(null);
    bump(n);
    playSound(n.move!.check ? "check" : n.move!.captured ? "capture" : "move");
  };

  const onIllegal = (from: string, to: string) => {
    const why = explainIllegal(position, parseSquare(from), parseSquare(to));
    setMessage(why ? why[settings.lang] : null);
  };

  const playLine = (pv: string[], count: number) => {
    let n = current;
    for (const m of pv.slice(0, count)) {
      const next = t.play(n, m);
      if (!next) break;
      n = next;
    }
    bump(n);
  };

  const load = () => {
    const text = io.trim();
    if (!text) return;
    try {
      if (/^[rnbakcpRNBAKCPhHeE1-9/]+\s+[wbr]/.test(text) || !/\s/.test(text.replace(/ [wbr] .*$/, ""))) {
        replaceTree(new GameTree(text));
      } else {
        const { tree: nt } = GameTree.fromPgn(text);
        replaceTree(nt, nt.mainline().at(-1) ?? nt.root);
      }
      setMessage(tt("Loaded.", "已载入。"));
    } catch (e) {
      setMessage(`${tt("Could not load", "无法载入")}: ${(e as Error).message}`);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${what} ${tt("copied.", "已复制。")}`);
    } catch {
      setIo(text);
      setMessage(`${what}: ${tt("see the box below (clipboard unavailable).", "见下方文本框（剪贴板不可用）。")}`);
    }
  };

  if (editing) {
    return (
      <PositionEditor
        initialFen={current.fen}
        onCancel={() => setEditing(false)}
        onDone={(fen) => {
          replaceTree(new GameTree(fen));
          setEditing(false);
        }}
      />
    );
  }

  const gameResult = gameOver ? (inCheck ? tt("Checkmate", "将死") : tt("No legal move (that loses)", "无子可动（判负）")) : null;

  return (
    <div className="analysis">
      <div className="board-wrap">
        <div className="evalbar">
          <EvalBar
            value={best ? scoreToBar(best.score) : 0}
            label={best ? formatScore(best.score) : ""}
            orientation={orientation}
            pending={!best || !engineOn}
          />
        </div>
        <Board
          fen={current.fen}
          orientation={orientation}
          legalMoves={legalMoves}
          onMove={onMove}
          onIllegal={onIllegal}
          lastMove={current.move?.iccs ?? null}
          check={checkSquare}
          arrows={arrows}
          announce={current.move ? announceMove(current.move, style, settings.lang) : ""}
        />
      </div>

      <aside className="panel">
        <EnginePanel
          enabled={engineOn}
          onToggle={setEngineOn}
          status={engine.status}
          error={engine.error}
          progress={engine.progress}
          fen={current.fen}
          multipv={multipv}
          onMultipv={setMultipv}
          style={style}
          onPlayLine={playLine}
          gameOver={gameOver}
        />
        {gameResult && <div className="message">{gameResult}</div>}
        {message && <div className="message">{message}</div>}

        <div className="nav">
          <button type="button" onClick={() => go(t.root)} aria-label="Start">⏮</button>
          <button type="button" onClick={() => current.parent && go(current.parent)} aria-label="Back">◀</button>
          <button type="button" onClick={() => current.children[0] && go(current.children[0])} aria-label="Forward">▶</button>
          <button type="button" onClick={() => go(t.mainline(current).at(-1) ?? current)} aria-label="End">⏭</button>
          <button type="button" onClick={() => setOrientation((o) => (o === "red" ? "black" : "red"))}>{tt("Flip", "翻转")}</button>
        </div>

        <MoveTreeView tree={t} current={current} style={style} onSelect={go} />

        <div className="buttons">
          <button
            type="button"
            disabled={!current.parent || current.parent.children[0] === current}
            onClick={() => {
              t.promote(current);
              bump(current);
            }}
          >
            {tt("Promote line", "设为主线")}
          </button>
          <button
            type="button"
            disabled={!current.parent}
            onClick={() => {
              const p = t.delete(current);
              if (p) bump(p);
            }}
          >
            {tt("Delete from here", "从此处删除")}
          </button>
          <button type="button" onClick={() => setEditing(true)}>{tt("Set up position", "摆棋")}</button>
          <button type="button" onClick={() => replaceTree(new GameTree())}>{tt("New", "新局")}</button>
        </div>
        <label className="comment-box">
          {tt("Comment on this move", "本步注释")}
          <textarea
            value={current.comment}
            disabled={!current.move}
            rows={2}
            onChange={(e) => {
              current.comment = e.target.value;
              bump(current);
            }}
          />
        </label>

        <div className="options">
          <label>
            {tt("Notation", "记谱")}
            <select value={style} onChange={(e) => setStyle(e.target.value as NotationStyle)}>
              <option value="chinese">中文</option>
              <option value="wxf">WXF</option>
              <option value="iccs">ICCS</option>
            </select>
          </label>
        </div>

        <h2>{tt("Import / export", "导入 / 导出")}</h2>
        <textarea className="io" rows={4} value={io} onChange={(e) => setIo(e.target.value)} placeholder={tt("Paste a FEN or PGN, then Load", "粘贴 FEN 或 PGN，然后载入")} aria-label="FEN / PGN" />
        <div className="buttons">
          <button type="button" onClick={load}>{tt("Load", "载入")}</button>
          <button type="button" onClick={() => copy(current.fen, "FEN")}>{tt("Copy FEN", "复制 FEN")}</button>
          <button type="button" onClick={() => copy(t.toPgn(), "PGN")}>{tt("Copy PGN", "复制 PGN")}</button>
          <button type="button" onClick={() => copy(new URL(nav.href(sharePath(t, current)), location.href).href, tt("Link", "链接"))}>{tt("Copy link", "复制链接")}</button>
        </div>

        <h2>{tt("Saved analyses", "已保存的分析")}</h2>
        <form
          className="fen-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const item = await saveAnalysis(title, t.toPgn({ Event: title || "Analysis" }));
              setSaved((s) => [item, ...s]);
              setTitle("");
              setMessage(tt("Saved in this browser.", "已保存在本浏览器中。"));
            } catch (err) {
              setMessage(`${tt("Could not save", "无法保存")}: ${(err as Error).message}`);
            }
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tt("Title", "标题")} aria-label={tt("Title", "标题")} />
          <button type="submit">{tt("Save", "保存")}</button>
        </form>
        {saved.length === 0 ? (
          <p className="muted">{tt("Nothing saved yet.", "还没有保存的分析。")}</p>
        ) : (
          <ul className="saved">
            {saved.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    const { tree: nt } = GameTree.fromPgn(s.pgn);
                    replaceTree(nt, nt.mainline().at(-1) ?? nt.root);
                  }}
                >
                  {s.title}
                </button>
                <span className="muted"> {new Date(s.savedAt).toLocaleString()}</span>
                <button
                  type="button"
                  className="link danger"
                  aria-label={`Delete ${s.title}`}
                  onClick={async () => {
                    await deleteSaved(s.id);
                    setSaved((all) => all.filter((x) => x.id !== s.id));
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
