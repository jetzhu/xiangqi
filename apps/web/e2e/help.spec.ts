import { expect, test } from "@playwright/test";
import { at } from "./helpers.js";

test("help page: shortcuts, accessibility and a prefilled bug report", async ({ page }) => {
  await page.goto(at("/en/help/"));
  await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Accessibility" })).toBeVisible();
  const href = await page.getByRole("link", { name: "Report a problem on GitHub" }).getAttribute("href");
  expect(href).toContain("github.com/jetzhu/xiangqi/issues/new");
  expect(new URL(href!).searchParams.get("body")).toContain("Version: ");
  await expect(page.getByText(/^Version /)).not.toHaveText("Version dev");
});

test("settings: reset lesson progress asks first", async ({ page }) => {
  await page.goto(at("/en/learn/the-board/"));
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Continue" }).click();
  await page.goto(at("/en/settings/"));
  await page.getByRole("button", { name: "Reset lesson progress" }).click();
  await page.getByRole("button", { name: /Click again to confirm/ }).click();
  await expect(page.getByText("Lesson progress reset.")).toBeVisible();
});

test.describe("update check", () => {
  // Requests made by a service worker (the Pages build's COOP/COEP worker) can't be mocked,
  // and this test doesn't need the engine.
  test.use({ serviceWorkers: "block" });
  test("a newer deployed build offers a reload", async ({ page }) => {
    await page.route("**/version.json", (route) => route.fulfill({ json: { build: "newer-build" } }));
    await page.goto(at("/en/"));
    // Wait for the app to hydrate (the home page renders client-side), then nudge the check.
    await page.locator(".hero").waitFor();
    await expect(async () => {
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(page.getByText("A new version of the site is available.")).toBeVisible({ timeout: 1000 });
    }).toPass();
  });
});

test("colour-blind theme can be chosen", async ({ page }) => {
  await page.goto(at("/en/settings/"));
  await page.getByLabel("Board theme").selectOption("colorblind");
  await page.goto(at("/en/play/"));
  await expect(page.getByLabel("Theme")).toHaveValue("colorblind");
});

test("privacy policy and terms are plain pages, readable without JavaScript", async ({ request }) => {
  const privacy = await (await request.get(at("/en/privacy/"))).text();
  expect(privacy).toContain("Google API Services User Data Policy");
  expect(privacy).toContain("United States");
  const terms = await (await request.get(at("/zh/terms/"))).text();
  expect(terms).toContain("使用条款");
});

test("sign-up links to the terms and privacy policy", async ({ page }) => {
  await page.goto(at("/en/signup/"));
  // The age check comes first (M14).
  await page.getByLabel("Month").selectOption("5");
  await page.getByLabel("Year").selectOption("1990");
  await page.getByLabel("Country or region").selectOption("US");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", /\/en\/privacy\/$/);
  await expect(page.getByRole("link", { name: "terms of use" })).toHaveAttribute("href", /\/en\/terms\/$/);
});
