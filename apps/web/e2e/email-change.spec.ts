import { expect, test } from "@playwright/test";
import { at } from "./helpers.js";

// M23b: the links in the email-change messages, opened without signing in.
const SUPABASE = "https://cxawhlamdwgojfzzgvqy.supabase.co";

test("the old address denies an email change; the new address confirms one", async ({ page }) => {
  const calls: string[] = [];
  const views: Record<string, Record<string, unknown>> = {
    old1: { kind: "old", status: "waiting", old: "a***@example.com", new: "t***@example.com", username: "Alice_1", due_at: "2026-11-01T10:00:00Z", undo_until: null, expired: false },
    new1: { kind: "new", status: "confirm-new", old: "a***@example.com", new: "n***@example.com", username: "Alice_1", due_at: null, undo_until: null, expired: false },
  };
  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers });
    const body = req.postDataJSON() as Record<string, unknown> | null;
    const t = String(body?.p_token);
    switch (new URL(req.url()).pathname) {
      case "/rest/v1/rpc/email_change_view":
        return route.fulfill({ status: 200, headers, json: views[t] ?? null });
      case "/rest/v1/rpc/answer_old_email":
        calls.push(`old:${body!.p_approve}`);
        views[t] = { ...views[t], status: "denied" };
        return route.fulfill({ status: 200, headers, json: "denied" });
      case "/rest/v1/rpc/confirm_new_email":
        calls.push("new");
        views[t] = { ...views[t], status: "waiting" };
        return route.fulfill({ status: 200, headers, json: "waiting" });
    }
    return route.fulfill({ status: 200, headers, json: null });
  });
  await page.goto(at("/en/email-change/?t=gone"));
  await expect(page.getByText("This link has expired or isn't valid.")).toBeVisible();
  await page.goto(at("/en/email-change/?t=old1"));
  await expect(page.getByText(/asked to change its email from a\*\*\*@example\.com to t\*\*\*@example\.com/)).toBeVisible();
  await page.getByRole("button", { name: "Deny: it wasn't me" }).click();
  await expect(page.getByText("Denied. Every device is signed out; please sign in and set a new password.")).toBeVisible();
  await page.goto(at("/zh/email-change/?t=new1"));
  await page.getByRole("button", { name: "确认新邮箱" }).click();
  await expect(page.getByText("已确认。我们已请你的当前邮箱批准；如无回应，更改将在 10 天后生效。")).toBeVisible();
  expect(calls).toEqual(["old:false", "new"]);
});
