import { describe, expect, it } from "vitest";
import { GameTree } from "../src/tree.js";

describe("GameTree", () => {
  it("builds a main line and reuses existing moves", () => {
    const t = new GameTree();
    const a = t.play(t.root, "h2e2")!;
    const b = t.play(a, "马８进７")!;
    expect(t.play(t.root, "C2.5")).toBe(a); // same move, any notation
    expect(t.mainline().map((n) => n.move!.chinese)).toEqual(["炮二平五", "马８进７"]);
    expect(t.path(b)).toEqual([a, b]);
    expect(t.play(b, "e0e2")).toBeNull();
  });

  it("adds, promotes and deletes variations", () => {
    const t = new GameTree();
    const a = t.play(t.root, "h2e2")!;
    t.play(a, "h9g7");
    const v = t.play(a, "h7e7")!; // 顺炮 as a variation
    expect(a.children.map((c) => c.move!.iccs)).toEqual(["h9g7", "h7e7"]);
    t.promote(v);
    expect(a.children[0]).toBe(v);
    expect(t.delete(v)).toBe(a);
    expect(a.children.map((c) => c.move!.iccs)).toEqual(["h9g7"]);
    expect(t.node(v.id)).toBeUndefined();
  });

  it("records captures and checks", () => {
    const t = new GameTree();
    const n = t.play(t.root, "h2h9")!;
    expect(n.move!.captured).toBe("n");
    expect(n.move!.check).toBe(false);
  });
});

describe("PGN", () => {
  it("round-trips moves, variations and comments", () => {
    const t = new GameTree();
    const a = t.play(t.root, "h2e2")!;
    a.comment = "Central cannon";
    const b = t.play(a, "h9g7")!;
    const v = t.play(a, "h7e7")!;
    t.play(v, "h0g2");
    t.play(b, "h0g2");
    const pgn = t.toPgn({ Event: "Test" });
    expect(pgn).toContain('[Format "ICCS"]');
    expect(pgn).toContain("1. h2e2 {Central cannon} h9g7 (1... h7e7 2. h0g2) 2. h0g2 *");

    const { tree, tags } = GameTree.fromPgn(pgn);
    expect(tags.Event).toBe("Test");
    expect(tree.toPgn({ Event: "Test" })).toBe(pgn);
    expect(tree.root.children[0]!.comment).toBe("Central cannon");
  });

  it("reads WXF and Chinese moves and a custom start position", () => {
    const pgn = `[FEN "4k4/9/R8/9/9/9/9/9/9/3K5 w - - 0 1"]\n\n1. R9+2 K5+1 2. R9-1 *`;
    const { tree } = GameTree.fromPgn(pgn);
    expect(tree.mainline().map((n) => n.move!.iccs)).toEqual(["a7a9", "e9e8", "a9a8"]);
    expect(tree.toPgn()).toContain('[FEN "4k4/9/R8/9/9/9/9/9/9/3K5 w - - 0 1"]');
    const cn = GameTree.fromPgn("1. 炮二平五 马８进７ 2. 马二进三 车９平８ *").tree;
    expect(cn.mainline().map((n) => n.move!.wxf)).toEqual(["C2.5", "H8+7", "H2+3", "R9.8"]);
  });

  it("numbers games that start with Black to move", () => {
    const t = new GameTree("rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1");
    const a = t.play(t.root, "h9g7")!;
    t.play(a, "h0g2");
    expect(t.toPgn()).toContain("1... h9g7 2. h0g2 *");
  });

  it("names the bad move in errors", () => {
    expect(() => GameTree.fromPgn("1. h2e2 e9e7 *")).toThrow(/e9e7/);
  });
});
