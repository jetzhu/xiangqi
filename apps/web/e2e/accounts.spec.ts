import { type Page, type Route, expect, test } from "@playwright/test";
import { at } from "./helpers.js";

// Supabase is replaced by a fake that answers the few calls the site makes, so these tests
// run offline and never create real accounts. Requests from the Pages build's service worker
// can't be intercepted, so it is blocked (none of this needs the engine).
test.use({ serviceWorkers: "block" });

const SUPABASE = "https://cxawhlamdwgojfzzgvqy.supabase.co";
const USER = {
  id: "11111111-2222-4333-8444-555555555555",
  aud: "authenticated",
  role: "authenticated",
  email: "alice@example.com",
  email_confirmed_at: "2026-10-07T00:00:00Z",
  user_metadata: { username: "Alice_1", lang: "en" },
  app_metadata: { provider: "email", providers: ["email"] },
  identities: [{ id: "i1", provider: "email" }],
  created_at: "2026-10-07T00:00:00Z",
};

/** A token shaped like Supabase's: a JWT whose payload names the user and expiry. */
function session() {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, exp, role: "authenticated", aud: "authenticated" })}.sig`;
  return { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "refresh-1", user: USER };
}

interface Calls {
  signup: { body: Record<string, unknown>; url: string }[];
  verify: Record<string, unknown>[];
  password: Record<string, unknown>[];
  updateUser: Record<string, unknown>[];
  logout: string[];
}

async function fakeSupabase(page: Page, opts: { takenNames?: string[]; password?: string } = {}): Promise<Calls> {
  const calls: Calls = { signup: [], verify: [], password: [], updateUser: [], logout: [] };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body, headers: { "access-control-allow-origin": "*" } });
  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS")
      return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const body = req.postDataJSON() as Record<string, unknown> | null;
    switch (url.pathname) {
      case "/rest/v1/rpc/username_problem": {
        const name = String(body?.name).toLowerCase();
        return json(route, opts.takenNames?.map((n) => n.toLowerCase()).includes(name) ? "taken" : null);
      }
      case "/rest/v1/profiles":
        return json(route, [{ username: "Alice_1" }]);
      case "/auth/v1/signup":
        calls.signup.push({ body: body ?? {}, url: req.url() });
        return json(route, { ...USER, email_confirmed_at: null, confirmation_sent_at: new Date().toISOString() });
      case "/auth/v1/verify":
        calls.verify.push(body ?? {});
        return json(route, session());
      case "/auth/v1/token":
        if (url.searchParams.get("grant_type") === "pkce") return json(route, session());
        calls.password.push(body ?? {});
        return body?.password === (opts.password ?? "correct-horse")
          ? json(route, session())
          : json(route, { code: "invalid_credentials", error_code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
      case "/auth/v1/user":
        if (req.method() === "PUT") calls.updateUser.push(body ?? {});
        return json(route, USER);
      case "/auth/v1/logout":
        calls.logout.push(url.searchParams.get("scope") ?? "");
        return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    }
    return json(route, { message: `unexpected ${req.method()} ${url.pathname}` }, 500);
  });
  return calls;
}

test("sign up: checks the username, then asks to confirm the email", async ({ page }) => {
  const calls = await fakeSupabase(page, { takenNames: ["bob-xq"] });
  await page.goto(at("/en/"));
  await page.getByRole("link", { name: "Sign up" }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();

  const username = page.getByLabel("Username");
  await username.fill("1234");
  await expect(page.getByText("A username can't be only digits.")).toBeVisible();
  await username.fill("Bob-XQ");
  await expect(page.getByText("This username is taken.")).toBeVisible();
  await username.fill("Alice_1");
  await expect(page.getByText("This username is taken.")).toBeHidden();

  await page.getByLabel("Email").fill("alice@example.com");
  await page.getByLabel("Password", { exact: true }).fill("correct-horse");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByText("We sent a link to alice@example.com.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Send again in \d+ s/ })).toBeDisabled();

  expect(calls.signup).toHaveLength(1);
  const { body, url } = calls.signup[0]!;
  expect(body).toMatchObject({ email: "alice@example.com", password: "correct-horse", data: { username: "Alice_1", lang: "en" } });
  // The email link comes back to this site's callback page, in the same language.
  expect(new URL(url).searchParams.get("redirect_to")).toMatch(/\/en\/auth\/callback\/$/);
  // Still a guest until the link is clicked.
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});

test("the email link signs the player in; the menu signs them out", async ({ page }) => {
  const calls = await fakeSupabase(page);
  await page.goto(at("/en/auth/callback/?token_hash=abc123&type=signup"));
  await expect(page.getByText("Your email is confirmed and you're signed in as Alice_1.")).toBeVisible();
  expect(calls.verify).toMatchObject([{ token_hash: "abc123", type: "email" }]);
  // The one-time token is gone from the address bar.
  expect(new URL(page.url()).search).toBe("");

  // Signed in on every page from now on, without asking again.
  await page.goto(at("/en/learn/"));
  const menu = page.getByRole("button", { name: /Alice_1/ });
  await expect(menu).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toHaveCount(0);
  await menu.click();
  await expect(page.getByText("alice@example.com")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  expect(calls.logout).toEqual(["local"]);
  await page.reload();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});

test("log in: wrong password, then back to the page the player came from", async ({ page }) => {
  const calls = await fakeSupabase(page);
  await page.goto(at("/en/bots/"));
  await page.getByRole("link", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/en\/login\/\?next=%2Fbots%2F$/);
  await page.getByLabel("Email").fill("alice@example.com");
  await page.getByLabel("Password", { exact: true }).fill("wrong-one");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator(".form-error")).toHaveText("Wrong email or password.");
  await page.getByLabel("Password", { exact: true }).fill("correct-horse");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/en\/bots\/$/);
  await expect(page.getByRole("button", { name: /Alice_1/ })).toBeVisible();
  expect(calls.password).toHaveLength(2);
});

test("reset password: link, then a new password", async ({ page }) => {
  const calls = await fakeSupabase(page);
  await page.route(`${SUPABASE}/auth/v1/recover**`, (route) => route.fulfill({ status: 200, json: {}, headers: { "access-control-allow-origin": "*" } }));
  await page.goto(at("/zh/login/"));
  await page.getByRole("link", { name: "忘记密码？" }).click();
  await page.getByLabel("邮箱").fill("alice@example.com");
  await page.getByRole("button", { name: "发送链接" }).click();
  await expect(page.getByText(/如果 alice@example.com 已注册/)).toBeVisible();

  await page.goto(at("/zh/auth/callback/?token_hash=r1&type=recovery"));
  await page.getByLabel("新密码").fill("a-new-password");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("heading", { name: "密码已保存" })).toBeVisible();
  expect(calls.verify).toMatchObject([{ token_hash: "r1", type: "recovery" }]);
  expect(calls.updateUser).toMatchObject([{ password: "a-new-password" }]);
});

test("an expired email link explains itself", async ({ page }) => {
  await fakeSupabase(page);
  await page.goto(at("/en/auth/callback/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"));
  await expect(page.locator(".form-error")).toHaveText("This link has expired or was already used.");
  await expect(page.getByRole("link", { name: "Reset password" })).toBeVisible();
});

// Supabase's default emails (used until a custom sender allows our templates) come back with
// ?code=, which only the browser that asked for the email can use.
const VERIFIER_KEY = "sb-cxawhlamdwgojfzzgvqy-auth-token-code-verifier";

test("a default-email password reset link leads to choosing a new password", async ({ page }) => {
  const calls = await fakeSupabase(page);
  await page.addInitScript((key) => localStorage.setItem(key, JSON.stringify("verifier123/recovery")), VERIFIER_KEY);
  await page.goto(at("/en/auth/callback/?code=c1"));
  await page.getByLabel("New password").fill("a-new-password");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("heading", { name: "Password saved" })).toBeVisible();
  expect(calls.updateUser).toMatchObject([{ password: "a-new-password" }]);
});

test("a default-email link opened in another browser says what to do", async ({ page }) => {
  await fakeSupabase(page);
  await page.goto(at("/en/auth/callback/?code=c2"));
  await expect(page.getByRole("heading", { name: "Open the link in the same browser" })).toBeVisible();
  await expect(page.getByText(/it is confirmed: log in here/)).toBeVisible();
});
