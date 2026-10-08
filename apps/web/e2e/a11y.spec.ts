import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { at } from "./helpers.js";

const PAGES = ["/en/", "/zh/", "/en/learn/", "/en/learn/the-board/", "/en/puzzles/", "/en/bots/", "/en/analysis/", "/en/play/", "/en/settings/", "/en/help/", "/en/stats/", "/en/signup/", "/zh/login/", "/en/privacy/", "/zh/terms/"];

for (const path of PAGES) {
  test(`no serious accessibility problems on ${path}`, async ({ page }) => {
    await page.goto(at(path));
    await page.locator("main#main").waitFor();
    await page.waitForLoadState("networkidle");
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
  });
}
