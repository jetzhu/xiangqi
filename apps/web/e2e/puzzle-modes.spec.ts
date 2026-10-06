import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { at, play } from "./helpers.js";

type P = { id: string; fen: string; solution: string[]; rating: number };
const puzzles = readFileSync(new URL("../../../content/puzzles/generated.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as P);

/** Today's daily puzzle, picked as dailyPuzzle() in @xq/puzzles does. */
function todaysPuzzle(): P {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const pool = puzzles.filter((p) => p.rating >= 600 && p.rating <= 1600).sort((a, b) => (a.id < b.id ? -1 : 1));
  let h = 2166136261;
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return pool[(h >>> 0) % pool.length]!;
}

test("daily puzzle: solve it, the day is marked and the streak starts", async ({ page }) => {
  const p = todaysPuzzle();
  await page.goto(at("/en/puzzles/?mode=daily"));
  await expect(page.getByRole("heading", { name: "Daily puzzle" })).toBeVisible();
  for (let i = 0; i < p.solution.length; i += 2) {
    await play(page, p.solution[i]!);
    if (i + 1 < p.solution.length) await page.waitForTimeout(700); // the opponent's reply
  }
  await expect(page.getByText("Solved! A new puzzle comes at midnight.")).toBeVisible();
  await expect(page.locator(".daily-calendar li.solved")).toHaveCount(1);
  await page.goto(at("/en/"));
  await expect(page.locator(".streak")).toContainText("Streak: 1 day");
});

test("puzzle rush: a run starts, counts and ends", async ({ page }) => {
  await page.goto(at("/en/puzzles/?mode=rush"));
  await page.getByRole("button", { name: /3 minutes/ }).click();
  await expect(page.locator(".rush-score")).toHaveText("0");
  await expect(page.locator(".clock")).toHaveText(/^[23]:\d\d$/);
  await page.getByRole("button", { name: "End run" }).click();
  await expect(page.getByRole("heading", { name: "Run over" })).toBeVisible();
  await page.getByRole("button", { name: "Change mode" }).click();
  await expect(page.getByRole("button", { name: /Survival/ })).toBeVisible();
});

test("puzzle rush: solving a puzzle scores a point", async ({ page }) => {
  await page.goto(at("/en/puzzles/?mode=rush"));
  await page.getByRole("button", { name: /Survival/ }).click();
  const id = await page.locator("aside[data-puzzle]").getAttribute("data-puzzle");
  const p = puzzles.find((x) => x.id === id)!;
  for (let i = 0; i < p.solution.length; i += 2) {
    await play(page, p.solution[i]!);
    if (i + 1 < p.solution.length) await page.waitForTimeout(700);
  }
  await expect(page.locator(".rush-score")).toHaveText("1");
  await expect(page.locator("aside[data-puzzle]")).not.toHaveAttribute("data-puzzle", id!);
});

test("puzzle tabs switch modes and keep the address", async ({ page }) => {
  await page.goto(at("/en/puzzles/"));
  await page.getByRole("tab", { name: "Puzzle Rush" }).click();
  await expect(page).toHaveURL(/mode=rush/);
  await page.getByRole("tab", { name: "Rated" }).click();
  await expect(page.getByText("Warm-up 1/")).toBeVisible();
});
