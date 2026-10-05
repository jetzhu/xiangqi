import type { Page } from "@playwright/test";

/** Play a move on the board by clicking the two points, e.g. "h2e2". */
export async function play(page: Page, move: string) {
  const board = page.getByRole("application").first();
  await board.locator(`[data-square="${move.slice(0, 2)}"]`).click({ force: true });
  await board.locator(`[data-square="${move.slice(2, 4)}"]`).click({ force: true });
}

/** The base path the build was made for: NEXT_PUBLIC_BASE_PATH, "/xiangqi" by default for Pages. */
export const BASE = process.env.E2E_PAGES ? (process.env.NEXT_PUBLIC_BASE_PATH ?? "/xiangqi") : "";
/** A site path under that base path. */
export const at = (path: string) => `${BASE}${path}`;
