import { describe, expect, it } from "vitest";
import { makeMove, parseSquare } from "../src/board.js";
import { normalizeNotation, parseMove, toChinese, toIccs, toWxf } from "../src/notation.js";
import { Position, START_FEN } from "../src/position.js";

const mv = (iccs: string) => makeMove(parseSquare(iccs.slice(0, 2)), parseSquare(iccs.slice(2)));

/** Play ICCS moves from a FEN and return the position before the last one plus that move. */
function at(fen: string, moves: string[]) {
  const p = Position.fromFen(fen);
  for (const m of moves.slice(0, -1)) p.make(mv(m));
  return { p, m: mv(moves.at(-1)!) };
}

describe("WXF and Chinese notation", () => {
  const cases: [string, string[], string, string][] = [
    // [fen, moves, wxf, chinese]
    [START_FEN, ["h2e2"], "C2.5", "炮二平五"],
    [START_FEN, ["b0c2"], "H8+7", "马八进七"],
    [START_FEN, ["h2e2", "h9g7"], "H8+7", "马８进７"],
    [START_FEN, ["h2e2", "h7e7"], "C8.5", "炮８平５"],
    [START_FEN, ["b2b9"], "C8+7", "炮八进七"],
    [START_FEN, ["i0i1"], "R1+1", "车一进一"],
    [START_FEN, ["g3g4"], "P3+1", "兵三进一"],
    [START_FEN, ["c0e2"], "E7+5", "相七进五"],
    [START_FEN, ["f0e1"], "A4+5", "仕四进五"],
    [START_FEN, ["h2e2", "c6c5"], "P3+1", "卒３进１"],
    [START_FEN, ["e0e1"], "K5+1", "帅五进一"],
  ];
  for (const [fen, moves, wxf, cn] of cases) {
    it(`${moves.join(" ")} → ${wxf} / ${cn}`, () => {
      const { p, m } = at(fen, moves);
      expect(toWxf(p, m)).toBe(wxf);
      expect(toChinese(p, m)).toBe(cn);
    });
  }

  it("retreating and sideways moves", () => {
    const { p } = at(START_FEN, ["h2e2"]);
    p.make(mv("h2e2"));
    p.make(mv("h9g7"));
    expect(toWxf(p, mv("e2e1"))).toBe("C5-1");
    expect(toChinese(p, mv("e2e1"))).toBe("炮五退一");
  });

  it("marks front and rear pieces on the same file", () => {
    // Two red chariots on file e (e3 front, e1 rear); kings off the e-file.
    const p = Position.fromFen("3k5/9/9/9/9/9/4R4/9/4R4/3K5 w - - 0 1");
    expect(toWxf(p, mv("e3f3"))).toBe("R+.4");
    expect(toChinese(p, mv("e3f3"))).toBe("前车平四");
    expect(toWxf(p, mv("e1e2"))).toBe("R-+1");
    expect(toChinese(p, mv("e1e2"))).toBe("后车进一");
  });

  it("front is relative to the mover for Black", () => {
    // Black cannons on e7 and e5: e5 is further forward for Black.
    const p = Position.fromFen("3k5/9/4c4/9/4c4/9/9/9/9/3K5 b - - 0 1");
    expect(toChinese(p, mv("e5d5"))).toBe("前炮平４");
    expect(toChinese(p, mv("e7e6"))).toBe("后炮进１");
  });

  it("three soldiers on one file use 前/中/后", () => {
    const p = Position.fromFen("3k5/9/4P4/4P4/4P4/9/9/9/9/3K5 w - - 0 1");
    expect(toChinese(p, mv("e6d6"))).toBe("中兵平六");
    expect(toChinese(p, mv("e7e8"))).toBe("前兵进一");
    expect(toChinese(p, mv("e5f5"))).toBe("后兵平四");
  });
});

describe("parsing", () => {
  const p = Position.fromFen(START_FEN);
  const h2e2 = mv("h2e2");
  it.each(["h2e2", "H2-E2", "C2.5", "C2=5", "c2.5", "炮二平五", "砲二平五", "炮2平5"])("%s", (text) => {
    expect(parseMove(p, text)).toBe(h2e2);
  });
  it("rejects illegal or unknown moves", () => {
    expect(parseMove(p, "h2h8")).toBeNull(); // cannon cannot move past its screen without capturing
    expect(parseMove(p, "e0e2")).toBeNull();
    expect(parseMove(p, "炮二平九")).toBeNull();
    expect(parseMove(p, "nonsense")).toBeNull();
  });
  it("normalizes Black full-width digits", () => {
    expect(normalizeNotation("马８进７")).toBe("H8+7");
  });
  it("round-trips every legal move of a busy position", () => {
    const q = Position.fromFen("r1bakab1r/9/1cn3nc1/p1p1C1p1p/9/9/P1P1P1P1P/2N4C1/9/R1BAKABNR b - - 0 1");
    for (const m of q.legalMoves()) {
      expect(parseMove(q, toWxf(q, m)), toWxf(q, m)).toBe(m);
      expect(parseMove(q, toChinese(q, m)), toChinese(q, m)).toBe(m);
      expect(parseMove(q, toIccs(m))).toBe(m);
    }
  });
});
