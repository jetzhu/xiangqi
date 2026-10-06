import { expect, test } from "@playwright/test";
import { at, play } from "./helpers.js";

const board = (page: import("@playwright/test").Page) => page.getByRole("application").first();

test("two-player: auto-flip turns the board and the clock runs", async ({ page }) => {
  await page.goto(at("/en/play/"));
  await page.getByLabel("Flip after each move").check();
  await page.getByLabel("Clock").selectOption("5");
  await expect(page.locator(".play-clocks")).toContainText("Red 5:00");
  await play(page, "h2e2");
  await expect(board(page)).toHaveAttribute("data-orientation", "black");
  await expect(page.locator(".play-clocks .clock.running")).toContainText("Black");
  await page.waitForTimeout(1500);
  await expect(page.locator(".play-clocks .clock.running")).not.toContainText("5:00");
});

test("confirm move holds the move until confirmed", async ({ page }) => {
  await page.goto(at("/en/settings/"));
  await page.getByLabel("Confirm each move").check();
  await page.goto(at("/en/play/"));
  await play(page, "h2e2");
  await expect(page.getByText("No moves yet.")).toBeVisible();
  await page.getByRole("button", { name: "Confirm move" }).click();
  await expect(page.locator("ol.moves li")).toHaveCount(1);
});

test("Red always at the bottom keeps Red down when playing Black", async ({ page }) => {
  await page.goto(at("/en/settings/"));
  await page.getByLabel("Red always at the bottom").check();
  await page.goto(at("/en/bots/"));
  await page.getByLabel("I play").selectOption("black");
  await page.locator("button.play").click();
  await expect(board(page)).toHaveAttribute("data-orientation", "red");
});

test("bot game: Abort before the first move goes back without a result", async ({ page }) => {
  await page.goto(at("/en/bots/"));
  await page.locator("button.play").click();
  await page.getByRole("button", { name: "Abort" }).click();
  await expect(page.locator("button.play")).toBeVisible();
});
