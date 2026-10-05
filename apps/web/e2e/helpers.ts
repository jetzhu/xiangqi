import type { Page } from "@playwright/test";

/** Play a move on the board by clicking the two points, e.g. "h2e2". */
export async function play(page: Page, move: string) {
  const board = page.getByRole("application").first();
  await board.locator(`[data-square="${move.slice(0, 2)}"]`).click({ force: true });
  await board.locator(`[data-square="${move.slice(2, 4)}"]`).click({ force: true });
}
