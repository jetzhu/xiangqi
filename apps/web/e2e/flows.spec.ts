import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { at, play } from "./helpers.js";

test("the root page sends visitors to their language", async ({ page }) => {
  await page.goto(at("/"));
  await expect(page).toHaveURL(/\/en\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Learn and play Xiangqi");
});

test("first lesson: read, answer the quizzes, finish", async ({ page }) => {
  await page.goto(at("/en/learn/the-board/"));
  // Four explanations…
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Continue" }).click();
  // …then two quizzes.
  await page.getByRole("button", { name: "On the points where lines cross" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Red", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/complete|mastered/i).first()).toBeVisible();
});

test("first puzzle: the warm-up mate in one", async ({ page }) => {
  // The first warm-up is the easiest mate-in-one in the set (see PuzzlesPage ONBOARDING).
  const puzzles = readFileSync(new URL("../../../content/puzzles/puzzles.jsonl", import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { fen: string; solution: string[]; rating: number; themes: string[] });
  const first = puzzles.filter((p) => p.themes.includes("mateIn1")).sort((a, b) => a.rating - b.rating)[0]!;
  await page.goto(at("/en/puzzles/"));
  await expect(page.getByText("Warm-up 1/")).toBeVisible();
  await play(page, first.solution[0]!);
  await expect(page.getByRole("button", { name: "Next puzzle" })).toBeVisible();
});

test("bot game: the bot answers a move", async ({ page }) => {
  await page.goto(at("/en/bots/"));
  await page.locator("button.play").click();
  await play(page, "h2e2");
  // Our move and the bot's reply fill the first row of the move list.
  await expect(page.locator("ol.moves li").first().locator(".mv").nth(1)).not.toHaveText("", { timeout: 30_000 });
});

test("bot game review: accuracy, graph and key moments after resigning", async ({ page }) => {
  await page.goto(at("/en/bots/"));
  await page.locator("button.play").click();
  await play(page, "h2e2");
  await expect(page.locator("ol.moves li").first().locator(".mv").nth(1)).not.toHaveText("", { timeout: 30_000 });
  // Throw the chariot forward into danger, then resign.
  await play(page, "i0i1");
  await expect(page.locator("ol.moves li").nth(1).locator(".mv").nth(1)).not.toHaveText("", { timeout: 30_000 });
  await page.getByRole("button", { name: "Resign" }).click();
  await page.getByRole("button", { name: "Confirm resign?" }).click();
  await expect(page.locator(".accuracy")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".accuracy strong").first()).toHaveText(/^\d+\.\d$/);
  await expect(page.locator(".eval-graph")).toBeVisible();
  const keys = page.getByRole("button", { name: /Key moments/ });
  if (await keys.count()) {
    await keys.click();
    await expect(page.locator(".moment")).toBeVisible();
    await page.getByRole("button", { name: "Show best" }).click();
    await expect(page.locator(".moment")).toContainText("Best was");
  }
});

test("analysis: import a PGN, the engine analyses it", async ({ page }) => {
  await page.goto(at("/en/analysis/"));
  await page.getByLabel("FEN / PGN").fill('[Format "ICCS"]\n\n1. h2e2 h9g7 2. h0g2 i9h9 *');
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.locator(".tree .mv:not(.start)")).toHaveCount(4);
  await expect(page).toHaveURL(/moves=h2e2/);
  await expect(page.locator("ol.lines li").first()).toBeVisible({ timeout: 30_000 });
});

test("lesson pages carry their text in the HTML", async ({ request }) => {
  const html = await (await request.get(at("/zh/learn/the-board/"))).text();
  expect(html).toContain('<article class="lesson-text">');
  expect(html).toContain('hrefLang="en"');
});

test("analysis board: review the game shows the graph, and a key moment's dot jumps to that position", async ({ page }) => {
  // Red's cannon takes the e6 soldier and is lost to the horse: a blunder.
  await page.goto(at("/en/analysis/?moves=h2e2,h9g7,e2e6,g7e6"));
  await page.getByRole("button", { name: "Review the game" }).click();
  const graph = page.getByRole("img", { name: "Red's winning chances over the main line" });
  await expect(graph).toBeVisible({ timeout: 60_000 });
  const dots = graph.locator("circle");
  await expect(dots.first()).toBeVisible();
  const before = page.url();
  await dots.first().click({ force: true });
  await expect.poll(() => page.url()).not.toBe(before);
});

test("analysis board: a game opened as Black turns the board and reviews Black's moves, with a switch to Red's", async ({ page }) => {
  await page.goto(at("/en/analysis/?moves=h2e2,h9g7,e2e6,g7e6&side=black"));
  await expect(page.getByRole("application").first()).toHaveAttribute("data-orientation", "black");
  await page.getByRole("button", { name: "Review the game" }).click();
  await expect(page.getByRole("img", { name: "Black's winning chances over the main line" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("radio", { name: "Black" })).toHaveAttribute("aria-checked", "true");
  await expect(page).toHaveURL(/side=black/);
  await page.getByRole("radio", { name: "Red" }).click();
  await expect(page.getByRole("img", { name: "Red's winning chances over the main line" })).toBeVisible();
  // Red's cannon blunder is now marked.
  await expect(page.getByRole("img", { name: "Red's winning chances over the main line" }).locator("circle").first()).toBeVisible();
  await expect(page).not.toHaveURL(/side=black/);
});

test("analysis board: going back in a game keeps the whole game in the link, through a reload", async ({ page }) => {
  await page.goto(at("/en/analysis/?moves=h2e2,h9g7,e2e6,g7e6"));
  await expect(page.locator(".tree .tok")).toHaveCount(4);
  // Back two moves: the link keeps all four, and says where the board is.
  await page.locator("body").press("ArrowLeft");
  await page.locator("body").press("ArrowLeft");
  await expect.poll(() => new URL(page.url()).searchParams.get("at")).toBe("2");
  expect(new URL(page.url()).searchParams.get("moves")).toBe("h2e2,h9g7,e2e6,g7e6");
  await page.reload();
  await expect(page.locator(".tree .tok")).toHaveCount(4);
  await expect(page.locator(".tree .mv.current")).toHaveText(/h9g7|马|H2\+3|8\+7/);
});
