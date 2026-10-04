import { describe, expect, it } from "vitest";
import { parseSquare, squareName } from "../src/board.js";
import { Game } from "../src/game.js";

const dests = (g: Game, from: string) =>
  g
    .destinations(parseSquare(from))
    .map(squareName)
    .sort();

function play(g: Game, moves: string[]) {
  for (const m of moves) {
    const r = g.move(m);
    if (!r) throw new Error(`illegal or game over at ${m} (result: ${g.result?.reason})`);
  }
}

describe("piece movement", () => {
  it("a hobbled horse cannot jump past its blocked leg", () => {
    // Red horse e4 with a red soldier on e5 blocking the forward leg.
    const g = new Game("4k4/9/9/9/4P4/4N4/9/9/9/3K5 w - - 0 1");
    expect(dests(g, "e4")).toEqual(["c3", "c5", "d2", "f2", "g3", "g5"]);
  });

  it("an elephant cannot cross the river or jump a blocked eye", () => {
    // Red elephant c4: a6 and e6 are across the river; the eye b3 is blocked by a red horse.
    const g = new Game("4k4/9/9/9/9/2B6/1N7/9/9/3K5 w - - 0 1");
    expect(dests(g, "c4")).toEqual(["e2"]);
  });

  it("a cannon needs exactly one screen to capture", () => {
    const g = new Game("4k4/9/9/9/4p4/9/4P4/9/4C4/3K5 w - - 0 1");
    expect(dests(g, "e1")).toContain("e5"); // over the e3 screen
    expect(dests(g, "e1")).not.toContain("e3");
    expect(dests(g, "e1")).not.toContain("e4");
  });

  it("a soldier moves sideways only after crossing the river", () => {
    const g = new Game("4k4/9/9/9/2P6/9/6P2/9/9/3K5 w - - 0 1");
    expect(dests(g, "g3")).toEqual(["g4"]);
    expect(dests(g, "c5")).toEqual(["b5", "c6", "d5"]);
  });

  it("the generals may not face each other (flying general)", () => {
    // Red cannon e4 is the only piece between the generals: it may not leave the e-file.
    const g = new Game("4k4/9/9/9/9/4C4/9/9/9/4K4 w - - 0 1");
    expect(dests(g, "e4")).toEqual(["e1", "e2", "e3", "e5", "e6", "e7", "e8"]);
  });

  it("a general stays inside the palace", () => {
    const g = new Game("4k4/9/9/9/9/9/9/9/9/3K5 w - - 0 1");
    expect(dests(g, "d0")).toEqual(["d1"]); // e0 faces the black general
  });
});

describe("game end", () => {
  it("checkmate", () => {
    // Chariot a9 checks along the back rank and covers d9; chariot f1 covers f9; horse g7 covers e8.
    const g = new Game("R3k4/9/6N2/9/9/9/9/9/5R3/3K5 b - - 0 1");
    expect(g.result?.reason).toBe("checkmate");
    expect(g.result?.winner).toBe("red");
    expect(g.result?.text.zh).toBe("红方胜：将死");
  });

  it("stalemate loses", () => {
    const g = new Game("4k4/9/6N2/9/9/9/9/9/3R1R3/3K5 b - - 0 1");
    expect(g.isCheck()).toBe(false);
    expect(g.result?.reason).toBe("stalemate");
    expect(g.result?.winner).toBe("red");
  });

  it("perpetual check loses on the third repetition", () => {
    const g = new Game("4k4/9/R8/9/9/9/9/9/9/3K5 w - - 0 1");
    play(g, ["a7a9", "e9e8", "a9a8", "e8e9", "a8a9", "e9e8", "a9a8", "e8e9"]);
    expect(g.result).toBeNull();
    play(g, ["a8a9"]);
    expect(g.result?.reason).toBe("perpetual-check");
    expect(g.result?.winner).toBe("black");
    expect(g.result?.text.en).toBe("Red loses: perpetual check");
    expect(g.move("e9e8")).toBeNull(); // game over
  });

  it("perpetual chase of the same unprotected piece loses", () => {
    // Red chariot keeps attacking the black horse as it hops between g8 and i7.
    const g = new Game("4k4/6n2/9/9/9/9/9/9/9/3K2R2 b - - 0 1");
    play(g, ["g8i7", "g0i0", "i7g8", "i0g0", "g8i7", "g0i0", "i7g8"]);
    expect(g.result).toBeNull();
    play(g, ["i0g0"]);
    expect(g.result?.reason).toBe("perpetual-chase");
    expect(g.result?.winner).toBe("black");
    expect(g.result?.text.zh).toBe("红方长捉判负");
  });

  it("attacking a piece that can capture back is not a chase", () => {
    // Chariots face each other on the same file each time: mutual attack counts as protection.
    const g = new Game("4k4/6r2/9/9/9/9/9/9/9/3K2R2 b - - 0 1");
    play(g, ["g8i8", "g0i0", "i8g8", "i0g0", "g8i8", "g0i0", "i8g8", "i0g0"]);
    expect(g.result?.reason).toBe("repetition");
    expect(g.result?.winner).toBeNull();
  });

  it("idle repetition is a draw", () => {
    const g = new Game("4k4/9/9/9/9/9/9/9/R8/3K5 w - - 0 1");
    play(g, ["a1a2", "e9e8", "a2a1", "e8e9", "a1a2", "e9e8", "a2a1", "e8e9"]);
    expect(g.result?.reason).toBe("repetition");
    expect(g.result?.text.zh).toBe("循环不变，和棋");
  });

  it("natural move limit draws", () => {
    const g = new Game("4k4/9/9/9/9/9/9/9/R8/3K5 w - - 99 60");
    expect(g.result).toBeNull();
    play(g, ["a1a2"]);
    expect(g.result?.reason).toBe("natural-limit");
  });

  it("undo clears a result and restores the position", () => {
    const g = new Game("4k4/9/9/9/9/9/9/9/R8/3K5 w - - 99 60");
    const fen = g.fen;
    play(g, ["a1a2"]);
    g.undo();
    expect(g.result).toBeNull();
    expect(g.fen).toBe(fen);
  });
});

describe("game record", () => {
  it("records notation, captures and checks", () => {
    const g = new Game();
    play(g, ["C2.5", "马８进７", "h0g2", "i9h9"]);
    expect(g.history.map((r) => r.chinese)).toEqual(["炮二平五", "马８进７", "马二进三", "车９平８"]);
    expect(g.history.map((r) => r.wxf)).toEqual(["C2.5", "H8+7", "H2+3", "R9.8"]);
    expect(g.history[0]!.captured).toBeNull();
    const g2 = new Game();
    const r = g2.move("h2h9")!;
    expect(r.captured).toBe("n");
    expect(r.wxf).toBe("C2+7");
  });
});

describe("position validation", () => {
  it("accepts the start position", () => {
    expect(() => new Game()).not.toThrow();
  });
  it.each([
    ["generals facing", "3k5/9/9/9/9/9/9/9/9/3K5 w - - 0 1", "face each other"],
    ["side not to move in check", "4k4/9/9/9/9/4R4/9/9/9/3K5 w - - 0 1", "not to move is in check"],
    ["elephant off its points", "4k4/9/9/9/9/9/9/9/4B4/3K5 w - - 0 1", "not an elephant point"],
    ["advisor outside the palace", "4k4/9/9/9/9/9/9/9/9/3KA4 w - - 0 1", "not an advisor point"],
    ["soldier behind its start", "4k4/9/9/9/9/9/9/9/4P4/3K5 w - - 0 1", "soldier cannot be there"],
    ["three chariots", "4k4/9/9/9/9/9/9/9/RRR6/3K5 w - - 0 1", "too many Red r"],
  ])("rejects %s", (_name, fen, message) => {
    expect(() => new Game(fen)).toThrow(message);
  });
});
