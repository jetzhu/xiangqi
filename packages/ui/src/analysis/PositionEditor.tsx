import { PieceGlyph, THEMES } from "@xq/board";
import { useState } from "react";
import { type Color, type PieceType, Position, START_FEN } from "xiangqi-core";
import { Board } from "../Board.js";
import { useT } from "../settings.js";

const TYPES: PieceType[] = ["k", "a", "b", "n", "r", "c", "p"];
// Generals on different files so a cleared board is already legal.
const EMPTY_FEN = "4k4/9/9/9/9/9/9/9/9/3K5";

/** Board rows (rank 9 first) as 9-char arrays of FEN letters or "". */
function parse(fen: string): string[][] {
  return fen
    .split(" ")[0]!
    .split("/")
    .map((row) => row.replace(/\d/g, (d) => ".".repeat(Number(d))).split("").map((c) => (c === "." ? "" : c)));
}
function build(rows: string[][], turn: "w" | "b"): string {
  const placement = rows
    .map((r) => r.map((c) => c || "1").join("").replace(/1+/g, (s) => String(s.length)))
    .join("/");
  return `${placement} ${turn} - - 0 1`;
}
const at = (square: string) => ({ file: square.charCodeAt(0) - 97, row: 9 - Number(square[1]) });

interface Props {
  initialFen: string;
  onDone: (fen: string) => void;
  onCancel: () => void;
}

export function PositionEditor({ initialFen, onDone, onCancel }: Props) {
  const { tt } = useT();
  const [rows, setRows] = useState(() => parse(initialFen));
  const [turn, setTurn] = useState<"w" | "b">(initialFen.split(" ")[1] === "b" ? "b" : "w");
  const [brush, setBrush] = useState<{ color: Color; type: PieceType } | "erase">({ color: "red", type: "r" });
  const fen = build(rows, turn);

  let errors: string[] = [];
  try {
    errors = Position.fromFen(fen).validate();
  } catch (e) {
    errors = [(e as Error).message];
  }

  const paint = (square: string, button: "left" | "right") => {
    const { file, row } = at(square);
    setRows((r) => {
      const next = r.map((x) => [...x]);
      if (button === "right" || brush === "erase") next[row]![file] = "";
      else next[row]![file] = brush.color === "red" ? brush.type.toUpperCase() : brush.type;
      return next;
    });
  };

  const theme = THEMES.wood;
  const swatch = (color: Color, type: PieceType) => {
    const active = brush !== "erase" && brush.color === color && brush.type === type;
    return (
      <button
        key={color + type}
        type="button"
        className={`swatch${active ? " active" : ""}`}
        onClick={() => setBrush({ color, type })}
        aria-pressed={active}
        aria-label={`${color} ${type}`}
      >
        <svg viewBox="-0.5 -0.5 1 1" width="34" height="34" aria-hidden>
          <PieceGlyph type={type} color={color} set="traditional" theme={theme} forwardUp={color === "red"} />
        </svg>
      </button>
    );
  };

  return (
    <div className="editor">
      <Board fen={fen} onSquareClick={paint} movable="none" drawable={false} showLegalMoves={false} ariaLabel={tt("Position editor", "摆棋")} />
      <div className="editor-side">
        <p className="muted">{tt("Pick a piece, then click points to place it. Right-click (or the eraser) removes.", "选一个棋子，再点击棋盘放置；右键（或橡皮）可移除。")}</p>
        <div className="palette">
          {TYPES.map((t) => swatch("red", t))}
          {TYPES.map((t) => swatch("black", t))}
          <button type="button" className={`swatch erase${brush === "erase" ? " active" : ""}`} onClick={() => setBrush("erase")} aria-pressed={brush === "erase"}>
            ✕
          </button>
        </div>
        <div className="buttons">
          <label>
            <input type="radio" checked={turn === "w"} onChange={() => setTurn("w")} /> {tt("Red to move", "红方走")}
          </label>
          <label>
            <input type="radio" checked={turn === "b"} onChange={() => setTurn("b")} /> {tt("Black to move", "黑方走")}
          </label>
        </div>
        <div className="buttons">
          <button type="button" onClick={() => setRows(parse(START_FEN))}>{tt("Start position", "初始局面")}</button>
          <button type="button" onClick={() => setRows(parse(EMPTY_FEN))}>{tt("Clear", "清空")}</button>
        </div>
        {errors.length > 0 ? (
          <ul className="errors">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : (
          <p className="ok">{tt("Position is legal.", "局面合法。")}</p>
        )}
        <code className="fen">{fen}</code>
        <div className="buttons">
          <button type="button" className="primary" disabled={errors.length > 0} onClick={() => onDone(fen)}>
            {tt("Analyse this position", "分析此局面")}
          </button>
          <button type="button" onClick={onCancel}>
            {tt("Cancel", "取消")}
          </button>
        </div>
      </div>
    </div>
  );
}
