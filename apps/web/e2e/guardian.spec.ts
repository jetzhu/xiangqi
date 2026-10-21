import { expect, test } from "@playwright/test";
import { at } from "./helpers.js";

// M23: a guardian opens the link from the confirmation email (no account) and confirms, letting
// their child link coaches without asking each time; later the same link ends it.
const SUPABASE = "https://cxawhlamdwgojfzzgvqy.supabase.co";

test("a guardian confirms a child's coach from the email's link, and can end it later", async ({ page }) => {
  const calls: string[] = [];
  let view: Record<string, unknown> | null = { student: "kid_wei", coach: "coach_lin", kind: "coach", status: "guardian", created_at: "2026-10-21T10:00:00Z", line_lowered: false, visits: 0 };
  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers });
    const body = req.postDataJSON() as Record<string, unknown> | null;
    switch (new URL(req.url()).pathname) {
      case "/rest/v1/rpc/guardian_view":
        return route.fulfill({ status: 200, headers, json: body!.p_token === "tok1" ? view : null });
      case "/rest/v1/rpc/guardian_answer":
        calls.push(`answer:${body!.p_confirm}:${body!.p_lower}`);
        view = { ...view, status: "coach", line_lowered: body!.p_lower };
        return route.fulfill({ status: 200, headers, json: null });
      case "/rest/v1/rpc/guardian_end":
        calls.push("end");
        view = { ...view, status: "ended" };
        return route.fulfill({ status: 200, headers, json: null });
    }
    return route.fulfill({ status: 200, headers, json: null });
  });
  await page.goto(at("/zh/guardian/?t=nope"));
  await expect(page.getByText("此链接已过期或无效。")).toBeVisible();
  await page.goto(at("/en/guardian/?t=tok1"));
  await expect(page.getByText("kid_wei asked coach_lin to be their coach")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("status")).toHaveText("Confirmed. The coach can now accept.");
  expect(calls).toEqual(["answer:true:true"]);
  await expect(page.getByText("Confirmed: waiting for the coach to accept.")).toBeVisible();
  await page.getByRole("button", { name: "End this link" }).click();
  await expect(page.getByText("This link has ended.")).toBeVisible();
  expect(calls).toEqual(["answer:true:true", "end"]);
});
