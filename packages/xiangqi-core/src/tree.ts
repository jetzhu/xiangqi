// A game tree with variations, for the analysis board, plus PGN import/export.
// The first child of a node is its main line; other children are variations.

import { type Color, type Move, typeChar, moveFrom, moveTo, type PieceType } from "./board.js";
import { parseMove, toChinese, toIccs, toWxf } from "./notation.js";
import { Position, START_FEN } from "./position.js";

export interface TreeNode {
  id: number;
  parent: TreeNode | null;
  children: TreeNode[];
  /** Position after this node's move (the root holds the start position). */
  fen: string;
  /** Number of moves from the root. */
  ply: number;
  /** The move that led here; null for the root. */
  move: {
    iccs: string;
    wxf: string;
    chinese: string;
    color: Color;
    piece: PieceType;
    captured: PieceType | null;
    check: boolean;
  } | null;
  comment: string;
}

export class GameTree {
  readonly root: TreeNode;
  private nextId = 1;
  private byId = new Map<number, TreeNode>();

  constructor(fen: string = START_FEN) {
    const p = Position.fromFen(fen);
    const errors = p.validate();
    if (errors.length) throw new Error(`illegal position: ${errors.join("; ")}`);
    this.root = { id: 0, parent: null, children: [], fen: p.toFen(), ply: 0, move: null, comment: "" };
    this.byId.set(0, this.root);
  }

  get startFen(): string {
    return this.root.fen;
  }

  node(id: number): TreeNode | undefined {
    return this.byId.get(id);
  }

  /**
   * Play a move (packed, ICCS, WXF or Chinese) after `at`. Returns the existing child if the
   * move was already in the tree, a new child otherwise, or null if the move is illegal.
   */
  play(at: TreeNode, input: Move | string): TreeNode | null {
    const pos = Position.fromFen(at.fen);
    const m = typeof input === "string" ? parseMove(pos, input) : pos.legalMoves().includes(input) ? input : null;
    if (m === null) return null;
    const iccs = toIccs(m);
    const existing = at.children.find((c) => c.move?.iccs === iccs);
    if (existing) return existing;
    const piece = pos.board[moveFrom(m)]!;
    const captured = pos.board[moveTo(m)]!;
    const wxf = toWxf(pos, m);
    const chinese = toChinese(pos, m);
    pos.make(m);
    const node: TreeNode = {
      id: this.nextId++,
      parent: at,
      children: [],
      fen: pos.toFen(),
      ply: at.ply + 1,
      move: {
        iccs,
        wxf,
        chinese,
        color: piece > 0 ? "red" : "black",
        piece: typeChar(piece),
        captured: captured === 0 ? null : typeChar(captured),
        check: pos.isInCheck(pos.turn),
      },
      comment: "",
    };
    at.children.push(node);
    this.byId.set(node.id, node);
    return node;
  }

  /** Nodes from the root (exclusive) to `node` (inclusive). */
  path(node: TreeNode): TreeNode[] {
    const out: TreeNode[] = [];
    for (let n: TreeNode | null = node; n && n.parent; n = n.parent) out.unshift(n);
    return out;
  }

  /** Main line continuing from `from` (exclusive), following first children. */
  mainline(from: TreeNode = this.root): TreeNode[] {
    const out: TreeNode[] = [];
    for (let n = from.children[0]; n; n = n.children[0]) out.push(n);
    return out;
  }

  /** Make `node` the main line at its branch point (and up the tree). */
  promote(node: TreeNode): void {
    for (let n: TreeNode | null = node; n && n.parent; n = n.parent) {
      const sibs = n.parent.children;
      const i = sibs.indexOf(n);
      if (i > 0) {
        sibs.splice(i, 1);
        sibs.unshift(n);
      }
    }
  }

  /** Remove `node` and everything after it. Returns its parent. */
  delete(node: TreeNode): TreeNode | null {
    const parent = node.parent;
    if (!parent) return null;
    parent.children = parent.children.filter((c) => c !== node);
    const drop = (n: TreeNode) => {
      this.byId.delete(n.id);
      n.children.forEach(drop);
    };
    drop(node);
    return parent;
  }

  // --- PGN -----------------------------------------------------------------------

  /** PGN with moves in ICCS (tag Format "ICCS"), variations in ( ) and comments in { }. */
  toPgn(tags: Record<string, string> = {}): string {
    const header: Record<string, string> = { Game: "Chinese Chess", Format: "ICCS", ...tags };
    if (this.root.fen !== Position.fromFen(START_FEN).toFen()) {
      header.SetUp = "1";
      header.FEN = this.root.fen;
    }
    header.Result ??= "*";
    const lines = Object.entries(header).map(([k, v]) => `[${k} "${v.replace(/"/g, "'")}"]`);

    const startFull = Position.fromFen(this.root.fen).fullmove;
    const blackFirst = this.root.fen.split(" ")[1] === "b";
    const moveNumber = (n: TreeNode) => startFull + Math.floor((n.ply - 1 + (blackFirst ? 1 : 0)) / 2);
    const tokens: string[] = [];
    const emit = (n: TreeNode, forceNumber: boolean) => {
      const red = n.move!.color === "red";
      if (red) tokens.push(`${moveNumber(n)}.`);
      else if (forceNumber) tokens.push(`${moveNumber(n)}...`);
      tokens.push(n.move!.iccs);
      if (n.comment) tokens.push(`{${n.comment.replace(/[{}]/g, "")}}`);
    };
    const walk = (parent: TreeNode, forceNumber: boolean) => {
      const [main, ...vars] = parent.children;
      if (!main) return;
      emit(main, forceNumber);
      for (const v of vars) {
        tokens.push("(");
        emit(v, true);
        walk(v, false);
        tokens.push(")");
      }
      walk(main, vars.length > 0);
    };
    if (this.root.comment) tokens.push(`{${this.root.comment}}`);
    walk(this.root, true);
    tokens.push(header.Result);
    return `${lines.join("\n")}\n\n${wrap(tokens.join(" ").replace(/\( /g, "(").replace(/ \)/g, ")"))}\n`;
  }

  /**
   * Read PGN. Moves may be ICCS ("h2e2", "H2-E2"), WXF ("C2.5") or Chinese ("炮二平五").
   * Returns the tree and the tags. Throws on an illegal move, naming it.
   */
  static fromPgn(text: string): { tree: GameTree; tags: Record<string, string> } {
    const tags: Record<string, string> = {};
    for (const m of text.matchAll(/\[(\w+)\s+"([^"]*)"\]/g)) tags[m[1]!] = m[2]!;
    const body = text.replace(/\[(\w+)\s+"([^"]*)"\]/g, " ");
    const tree = new GameTree(tags.FEN || START_FEN);
    let current: TreeNode = tree.root;
    const stack: TreeNode[] = [];
    const re = /\{([^}]*)\}|;[^\n]*|\(|\)|\$\d+|(?:1-0|0-1|1\/2-1\/2|\*)(?=\s|$)|\d+\.(?:\.\.)?|[^\s(){}]+/g;
    for (const m of body.matchAll(re)) {
      const tok = m[0];
      if (m[1] !== undefined) {
        current.comment = (current.comment ? current.comment + " " : "") + m[1].trim();
      } else if (tok === "(") {
        stack.push(current);
        current = current.parent ?? current; // a variation replaces the last move
      } else if (tok === ")") {
        current = stack.pop() ?? current;
      } else if (/^(;|\$|\d+\.|1-0$|0-1$|1\/2-1\/2$|\*$)/.test(tok)) {
        // move numbers, NAGs, results, line comments
      } else {
        const next = tree.play(current, tok.replace(/^(\d+)\.+/, ""));
        if (!next) throw new Error(`illegal or unknown move "${tok}" after ${current.move?.iccs ?? "the start"}`);
        current = next;
      }
    }
    return { tree, tags };
  }
}

function wrap(s: string, width = 80): string {
  const out: string[] = [];
  let line = "";
  for (const word of s.split(" ")) {
    if (line && line.length + word.length + 1 > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.join("\n");
}
