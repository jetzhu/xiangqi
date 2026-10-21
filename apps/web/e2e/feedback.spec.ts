import { expect, test } from "@playwright/test";
import { at } from "./helpers.js";

// M21: a guest sends feedback (no email field, no reply option) and reads the Support page.
const SUPABASE = "https://cxawhlamdwgojfzzgvqy.supabase.co";

test("a guest sends feedback without giving any contact details", async ({ page }) => {
  const sent: Record<string, unknown>[] = [];
  let calls = 0;
  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers });
    if (new URL(req.url()).pathname === "/rest/v1/rpc/send_feedback") {
      calls++;
      if (calls > 1) return route.fulfill({ status: 400, headers, json: { code: "P0001", message: "feedback limit: 5 a day" } });
      sent.push(req.postDataJSON() as Record<string, unknown>);
    }
    return route.fulfill({ status: 200, headers, json: null });
  });
  await page.goto(at("/zh/feedback/"));
  await expect(page.getByRole("heading", { name: "意见反馈" })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.locator(".feedback-page").getByRole("link", { name: "登录" })).toBeVisible();
  await page.getByRole("radio", { name: "课程、题目或机器人" }).check();
  await page.getByLabel("你的反馈").fill("第三课的答案好像不对");
  await page.getByRole("button", { name: "发送反馈" }).click();
  await expect(page.getByText("谢谢！我们已收到你的反馈。")).toBeVisible();
  expect(sent[0]).toMatchObject({ p_kind: "content", p_message: "第三课的答案好像不对", p_lang: "zh", p_may_reply: false });
  await page.getByRole("button", { name: "继续反馈" }).click();
  await page.getByLabel("你的反馈").fill("再来一条");
  await page.getByRole("button", { name: "发送反馈" }).click();
  await expect(page.locator(".feedback-page").getByRole("alert")).toHaveText("今天已发送 5 条，谢谢！请明天再发。");
});

test("the Support page is readable without JavaScript and links from every page's footer", async ({ page, request }) => {
  const html = await (await request.get(at("/en/support/"))).text();
  expect(html).toContain("free for everyone, with no ads, forever");
  expect(html).toContain("not tax-deductible");
  await page.goto(at("/en/learn/"));
  await page.locator(".site-footer").getByRole("link", { name: "Support us" }).click();
  await expect(page.getByRole("heading", { name: "Support Xiangqi School" })).toBeVisible();
});
