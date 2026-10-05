import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Game, START_FEN, toIccs } from "xiangqi-core";
import { XiangqiBoard } from "../src/index.js";

afterEach(cleanup);

const legal = (fen: string) => new Game(fen).legalMoves().map(toIccs);
const hit = (container: HTMLElement, square: string) => container.querySelector(`[data-square="${square}"]`)!;
const click = (container: HTMLElement, square: string) => {
  fireEvent.pointerDown(hit(container, square), { button: 0, pointerId: 1 });
  fireEvent.pointerUp(hit(container, square), { button: 0, pointerId: 1 });
};

describe("XiangqiBoard", () => {
  it("draws 32 pieces and 90 hit targets for the start position", () => {
    const { container } = render(<XiangqiBoard fen={START_FEN} />);
    expect(container.querySelectorAll("[data-square]")).toHaveLength(90);
    expect(container.querySelectorAll("text").length).toBeGreaterThanOrEqual(32);
    expect(screen.getByRole("application", { name: "Xiangqi board" })).toBeTruthy();
  });

  it("makes a legal move with click-click", () => {
    const onMove = vi.fn();
    const { container } = render(<XiangqiBoard fen={START_FEN} legalMoves={legal(START_FEN)} onMove={onMove} />);
    click(container, "h2");
    click(container, "e2");
    expect(onMove).toHaveBeenCalledWith("h2e2");
  });

  it("shows legal destination dots for the selected piece", () => {
    const { container } = render(<XiangqiBoard fen={START_FEN} legalMoves={legal(START_FEN)} />);
    const before = container.querySelectorAll("circle").length;
    click(container, "b0"); // horse: a2 and c2
    expect(container.querySelectorAll("circle").length).toBe(before + 2 + 2); // selection fill + ring, 2 dots
  });

  it("reports an illegal destination", () => {
    const onMove = vi.fn();
    const onIllegal = vi.fn();
    const { container } = render(
      <XiangqiBoard fen={START_FEN} legalMoves={legal(START_FEN)} onMove={onMove} onIllegal={onIllegal} />,
    );
    click(container, "h2");
    click(container, "h8");
    expect(onMove).not.toHaveBeenCalled();
    expect(onIllegal).toHaveBeenCalledWith("h2", "h8");
  });

  it("does not let the wrong side or a non-movable colour move", () => {
    const onMove = vi.fn();
    const { container, rerender } = render(<XiangqiBoard fen={START_FEN} legalMoves={legal(START_FEN)} onMove={onMove} />);
    click(container, "h7"); // Black cannon, but Red to move
    click(container, "e7");
    rerender(<XiangqiBoard fen={START_FEN} legalMoves={legal(START_FEN)} onMove={onMove} movable="black" />);
    click(container, "h2");
    click(container, "e2");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("switching to another own piece changes the selection", () => {
    const onMove = vi.fn();
    const { container } = render(<XiangqiBoard fen={START_FEN} legalMoves={legal(START_FEN)} onMove={onMove} />);
    click(container, "h2");
    click(container, "b2");
    click(container, "e2");
    expect(onMove).toHaveBeenCalledWith("b2e2");
  });

  it("supports keyboard play", () => {
    const onMove = vi.fn();
    render(<XiangqiBoard fen={START_FEN} legalMoves={legal(START_FEN)} onMove={onMove} />);
    const board = screen.getByRole("application");
    board.focus();
    // Cursor starts on e0. Move to h2: right 3, up 2.
    for (const key of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowUp", "ArrowUp"]) fireEvent.keyDown(board, { key });
    fireEvent.keyDown(board, { key: "Enter" });
    for (const key of ["ArrowLeft", "ArrowLeft", "ArrowLeft"]) fireEvent.keyDown(board, { key });
    fireEvent.keyDown(board, { key: "Enter" });
    expect(onMove).toHaveBeenCalledWith("h2e2");
  });

  it("announces the square under the keyboard cursor", () => {
    const { container } = render(<XiangqiBoard fen={START_FEN} />);
    const board = screen.getByRole("application");
    fireEvent.keyDown(board, { key: "ArrowUp" });
    expect(container.querySelector("[aria-live]")!.textContent).toBe("e1, empty");
    fireEvent.keyDown(board, { key: "ArrowDown" });
    expect(container.querySelector("[aria-live]")!.textContent).toBe("e0, Red General");
  });

  it("flips for Black at the bottom", () => {
    const onMove = vi.fn();
    const fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1";
    const { container } = render(<XiangqiBoard fen={fen} legalMoves={legal(fen)} onMove={onMove} orientation="black" />);
    const h9 = hit(container, "h9");
    const a0 = hit(container, "a0");
    // With Black at the bottom, a0 is top-right and h9 near bottom-left.
    expect(Number(a0.getAttribute("x"))).toBeGreaterThan(Number(h9.getAttribute("x")));
    expect(Number(a0.getAttribute("y"))).toBeLessThan(Number(h9.getAttribute("y")));
    click(container, "h9");
    click(container, "g7");
    expect(onMove).toHaveBeenCalledWith("h9g7");
  });

  it("draws arrows, badges and a check marker", () => {
    const { container } = render(
      <XiangqiBoard
        fen={START_FEN}
        arrows={[{ from: "h2", to: "e2" }]}
        badges={[{ square: "e3", icon: "blunder" }]}
        check="e0"
        pieceSet="icons"
        theme="high-contrast"
      />,
    );
    expect(container.querySelectorAll("line[marker-end]")).toHaveLength(1);
    expect(container.textContent).toContain("??");
    expect(container.querySelector("[style*='pulse']")).toBeTruthy();
  });
});

describe("editing mode", () => {
  it("reports clicks instead of moving pieces", () => {
    const onMove = vi.fn();
    const onSquareClick = vi.fn();
    const { container } = render(
      <XiangqiBoard fen={START_FEN} legalMoves={legal(START_FEN)} onMove={onMove} onSquareClick={onSquareClick} />,
    );
    click(container, "h2");
    fireEvent.pointerDown(hit(container, "e5"), { button: 2, pointerId: 1 });
    expect(onSquareClick.mock.calls).toEqual([["h2", "left"], ["e5", "right"]]);
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe("stars", () => {
  it("draws a star on each given point", () => {
    const { container } = render(<XiangqiBoard fen={START_FEN} stars={["e5", "a4"]} />);
    expect([...container.querySelectorAll("[data-star]")].map((g) => g.getAttribute("data-star"))).toEqual(["e5", "a4"]);
  });
});
