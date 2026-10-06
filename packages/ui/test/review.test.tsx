// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReviewedMove } from "@xq/engine";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Game } from "xiangqi-core";
import { GameReview, type ReviewFocus } from "../src/bots/GameReview.js";
import { SettingsProvider } from "../src/settings.js";

const TEXT = {
  book: { en: "Book move", zh: "" },
  best: { en: "Best move", zh: "" },
  excellent: { en: "Excellent", zh: "" },
  good: { en: "Good", zh: "" },
  inaccuracy: { en: "Inaccuracy", zh: "" },
  mistake: { en: "Mistake", zh: "" },
  miss: { en: "Miss", zh: "" },
  blunder: { en: "Blunder", zh: "" },
};

function Harness() {
  const g = new Game();
  for (const m of ["h2e2", "h9g7", "i0i1", "b9c7"]) g.move(m);
  const reviewed: ReviewedMove[] = [
    { index: 0, move: "h2e2", moverIsRed: true, grade: "book", loss: 0, bestMove: "h2e2", after: { cp: 20 } },
    { index: 1, move: "h9g7", moverIsRed: false, grade: "book", loss: 0, bestMove: "h9g7", after: { cp: 20 } },
    { index: 2, move: "i0i1", moverIsRed: true, grade: "blunder", loss: 0.3, bestMove: "h0g2", after: { cp: -400 } },
    { index: 3, move: "b9c7", moverIsRed: false, grade: "good", loss: 0.03, bestMove: "b9c7", after: { cp: -380 } },
  ];
  const [focus, setFocus] = useState<ReviewFocus | null>(null);
  return (
    <GameReview
      reviewed={reviewed}
      history={g.history}
      playerColor="red"
      botName="Bot"
      gradeText={TEXT}
      notate={(r) => r.iccs}
      bestText={(i) => reviewed[i]!.bestMove}
      focus={focus}
      onFocus={setFocus}
    />
  );
}

describe("game review", () => {
  it("shows accuracy and walks through the player's key moments", () => {
    render(
      <SettingsProvider lang="en">
        <Harness />
      </SettingsProvider>,
    );
    expect(screen.getByText("Your accuracy")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Key moments (1)" }));
    expect(screen.getByText(/You played/).textContent).toContain("i0i1");
    expect(screen.getByText(/You played/).textContent).toContain("Blunder");
    fireEvent.click(screen.getByRole("button", { name: "Show best" }));
    expect(screen.getByText(/Best was/).textContent).toContain("h0g2");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("Find a better move on the board.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Final position" }));
    expect(screen.queryByText(/You played/)).toBeNull();
  });
});
