import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { play } from "./helpers.js";

test("the root page sends visitors to their language", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/en\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Learn and play Xiangqi");
});

test("first lesson: read, answer the quizzes, finish", async ({ page }) => {
  await page.goto("/en/learn/the-board/");
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
  const puzzles = readFileSync(new URL("../../../content/puzzles/generated.jsonl", import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { fen: string; solution: string[]; rating: number; themes: string[] });
  const first = puzzles.filter((p) => p.themes.includes("mateIn1")).sort((a, b) => a.rating - b.rating)[0]!;
  await page.goto("/en/puzzles/");
  await expect(page.getByText("Warm-up 1/")).toBeVisible();
  await play(page, first.solution[0]!);
  await expect(page.getByRole("button", { name: "Next puzzle" })).toBeVisible();
});

test("bot game: the bot answers a move", async ({ page }) => {
  await page.goto("/en/bots/");
  await page.locator("button.play").click();
  await play(page, "h2e2");
  // Our move and the bot's reply fill the first row of the move list.
  await expect(page.locator("ol.moves li").first().locator(".mv").nth(1)).not.toHaveText("", { timeout: 30_000 });
});

test("analysis: import a PGN, the engine analyses it", async ({ page }) => {
  await page.goto("/en/analysis/");
  await page.getByLabel("FEN / PGN").fill('[Format "ICCS"]\n\n1. h2e2 h9g7 2. h0g2 i9h9 *');
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.locator(".tree .mv:not(.start)")).toHaveCount(4);
  await expect(page).toHaveURL(/moves=h2e2/);
  await expect(page.locator("ol.lines li").first()).toBeVisible({ timeout: 30_000 });
});

test("lesson pages carry their text in the HTML", async ({ request }) => {
  const html = await (await request.get("/zh/learn/the-board/")).text();
  expect(html).toContain('<article class="lesson-text">');
  expect(html).toContain('hrefLang="en"');
});
