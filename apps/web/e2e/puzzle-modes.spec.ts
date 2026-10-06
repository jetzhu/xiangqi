import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { at, play } from "./helpers.js";

type P = { id: string; fen: string; solution: string[]; rating: number; themes: string[] };
const puzzles = readFileSync(new URL("../../../content/puzzles/puzzles.jsonl", import.meta.url), "utf8")
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

test("choosing a level swaps an untouched rated puzzle for one from that level", async ({ page }) => {
  // A player past the warm-up, rated 800.
  await page.goto(at("/en/"));
  const warmups = puzzles.filter((p) => p.themes.includes("mateIn1")).sort((a, b) => a.rating - b.rating).slice(0, 5);
  await page.evaluate(async (ids) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open("xq-v1-puzzles");
      r.onupgradeneeded = () => r.result.createObjectStore("puzzles");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const state = { rating: { rating: 800, rd: 120 }, history: ids.map((id) => ({ id, score: 1, ratingAfter: 800, at: "2026-10-01T00:00:00Z" })) };
    await new Promise((res) => {
      const tx = db.transaction("puzzles", "readwrite");
      tx.objectStore("puzzles").put(state, "state");
      tx.oncomplete = res;
    });
    db.close();
  }, warmups.map((p) => p.id));
  await page.goto(at("/en/puzzles/"));
  const panel = page.locator("aside[data-puzzle]");
  const before = Number(await panel.getAttribute("data-puzzle-rating"));
  expect(before).toBeLessThan(1000);
  await page.getByLabel("Difficulty").selectOption("extraHard");
  await expect(panel).not.toHaveAttribute("data-puzzle-rating", String(before));
  expect(Number(await panel.getAttribute("data-puzzle-rating"))).toBeGreaterThanOrEqual(1600);
  await page.getByLabel("Difficulty").selectOption("standard");
  const r = Number(await panel.getAttribute("data-puzzle-rating"));
  expect(r).toBeGreaterThanOrEqual(800);
  expect(r).toBeLessThan(1200);
});
