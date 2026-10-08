import { type Page, expect, test } from "@playwright/test";
import { at, play } from "./helpers.js";

/** Start a rated game as Red and play two moves each (4 plies, enough to count). */
async function ratedGameToFourPlies(page: Page) {
  await page.goto(at("/en/bots/"));
  await page.locator(".rated-choice .choice").nth(1).click(); // Casual, Rated
  await expect(page.getByRole("radio", { name: /Rated/ })).toBeChecked();
  await expect(page.getByLabel("Hints", { exact: true })).toBeDisabled();
  await page.locator("button.play").click();
  await play(page, "h2e2");
  await expect(page.locator("ol.moves li").first().locator(".mv").nth(1)).not.toHaveText("", { timeout: 30_000 });
  await play(page, "h0g2");
  await expect(page.locator("ol.moves li").nth(1).locator(".mv").nth(1)).not.toHaveText("", { timeout: 30_000 });
}

test("a rated game changes the bot rating and says by how much", async ({ page }) => {
  await ratedGameToFourPlies(page);
  await expect(page.getByRole("button", { name: "Hint" })).toHaveCount(0);
  await page.getByRole("button", { name: "Resign" }).click();
  await page.getByRole("button", { name: "Confirm resign?" }).click();
  await expect(page.locator(".rating-line")).toContainText(/Bot rating 800 → \d+ \(-\d+\)/);
});

test("a casual game leaves the rating alone and says so", async ({ page }) => {
  await page.goto(at("/en/bots/"));
  await page.locator("button.play").click();
  await play(page, "h2e2");
  await expect(page.locator("ol.moves li").first().locator(".mv").nth(1)).not.toHaveText("", { timeout: 30_000 });
  await play(page, "h0g2");
  await expect(page.locator("ol.moves li").nth(1).locator(".mv").nth(1)).not.toHaveText("", { timeout: 30_000 });
  await page.getByRole("button", { name: "Resign" }).click();
  await page.getByRole("button", { name: "Confirm resign?" }).click();
  await expect(page.locator(".rating-line")).toHaveText("Casual game: your rating is unchanged.");
});

test("closing a rated game in progress counts as a loss", async ({ page }) => {
  await ratedGameToFourPlies(page);
  await page.reload(); // the player walks away mid-game
  await expect(page.locator(".rated-choice")).toBeVisible();
  // The bots page settles the abandoned game: the rating shown is below the starting 800.
  await expect(page.locator(".rated-choice")).toContainText(/now 7\d\d\?/);
});

test("the stats page shows the rated game, the rating and the history", async ({ page }) => {
  await ratedGameToFourPlies(page);
  await page.getByRole("button", { name: "Resign" }).click();
  await page.getByRole("button", { name: "Confirm resign?" }).click();
  await expect(page.locator(".rating-line")).toContainText("Bot rating 800 →");
  await page.goto(at("/en/stats/"));
  const card = page.locator(".stat-card").first();
  await expect(card).toContainText("Bot rating");
  await expect(card).toContainText(/7\d\d\?/);
  await expect(card).toContainText("1 rated games");
  await expect(page.locator(".results")).toContainText("Little Soldier");
  await page.getByRole("tab", { name: "Games (1)" }).click();
  await expect(page).toHaveURL(/tab=games/);
  const row = page.locator(".game-list tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Lost");
  await expect(row).toContainText("resigned");
  await expect(row.getByRole("link", { name: "Review" })).toHaveAttribute("href", /analysis\/\?moves=h2e2,/);
  await page.getByLabel("Type").selectOption("casual");
  await expect(page.getByText("No games match these filters.")).toBeVisible();
});

test("the stats page invites a new player to play", async ({ page }) => {
  await page.goto(at("/en/stats/"));
  await expect(page.getByRole("heading", { name: "My stats" })).toBeVisible();
  await expect(page.getByText("No rated bot games yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Play a bot" })).toBeVisible();
});
