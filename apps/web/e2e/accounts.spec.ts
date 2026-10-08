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
  authorize: string[];
  profileUpdates: Record<string, unknown>[];
  unlinked: string[];
  /** The account's synced rows, as the fake database holds them. */
  tables: Tables;
}

/** The tables M11 syncs, one signed-in user's rows. */
interface Tables {
  lesson_progress: { lesson_id: string; status: string }[];
  player_state: { key: string; value: unknown }[];
  analyses: { id: string; title: string; data: unknown; updated_at: string }[];
  settings: { data: Record<string, unknown> }[];
}
const KEYS: Record<keyof Tables, string[]> = { lesson_progress: ["lesson_id"], player_state: ["key"], analyses: ["id"], settings: [] };
const RANK: Record<string, number> = { new: 0, started: 1, mastered: 2 };

/** What the database does on an upsert (packages/db): keep the better lesson status, merge player_state. */
function mergeRow(table: keyof Tables, old: Record<string, unknown>, row: Record<string, unknown>) {
  if (table === "lesson_progress" && RANK[old.status as string]! > RANK[row.status as string]!) return { ...row, status: old.status };
  if (table === "player_state") {
    const [a, b] = [old.value, row.value];
    if (Array.isArray(a) && Array.isArray(b)) return { ...row, value: [...new Set([...a, ...b])].sort() };
    const value: Record<string, number> = { ...(a as Record<string, number>) };
    for (const [k, v] of Object.entries(b as Record<string, number>)) value[k] = Math.max(value[k] ?? 0, v);
    return { ...row, value };
  }
  return { ...old, ...row };
}

interface FakeOptions {
  takenNames?: string[];
  password?: string;
  /** Sign-in providers switched on in the fake project. */
  providers?: string[];
  /** The profile the site reads after signing in. */
  profile?: { username: string; username_chosen: boolean };
  /** Who comes back from Google/Microsoft/GitHub. */
  oauthUser?: typeof USER;
  /** What the account already holds (saved from another device). */
  tables?: Partial<Tables>;
}

async function fakeSupabase(page: Page, opts: FakeOptions = {}): Promise<Calls> {
  const tables: Tables = { lesson_progress: [], player_state: [], analyses: [], settings: [], ...structuredClone(opts.tables ?? {}) };
  const calls: Calls = { signup: [], verify: [], password: [], updateUser: [], logout: [], authorize: [], profileUpdates: [], unlinked: [], tables };
  const profile = { ...(opts.profile ?? { username: "Alice_1", username_chosen: true }) };
  let user = { ...USER, identities: [...USER.identities] };
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
        if (req.method() === "PATCH") {
          calls.profileUpdates.push(body ?? {});
          Object.assign(profile, body, { username_chosen: true });
          return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
        }
        return json(route, [profile]);
      case "/auth/v1/settings":
        return json(route, { external: Object.fromEntries((opts.providers ?? []).map((p) => [p, true])) });
      case "/auth/v1/authorize": {
        // The browser leaves for the provider, which sends it straight back with a code.
        calls.authorize.push(url.searchParams.get("provider") ?? "");
        if (opts.oauthUser) user = opts.oauthUser;
        return route.fulfill({ status: 302, headers: { location: `${url.searchParams.get("redirect_to")}?code=oauth1` } });
      }
      case "/auth/v1/user/identities/authorize": {
        const provider = url.searchParams.get("provider") ?? "";
        calls.authorize.push(`link:${provider}`);
        user = { ...user, identities: [...user.identities, { id: `i-${provider}`, provider, identity_id: `i-${provider}`, identity_data: { email: "alice@users.example" } } as never] };
        return json(route, { url: `${url.searchParams.get("redirect_to")}?code=link1` });
      }
      case "/auth/v1/signup":
        calls.signup.push({ body: body ?? {}, url: req.url() });
        return json(route, { ...USER, email_confirmed_at: null, confirmation_sent_at: new Date().toISOString() });
      case "/auth/v1/verify":
        calls.verify.push(body ?? {});
        return json(route, session());
      case "/auth/v1/token":
        if (url.searchParams.get("grant_type") === "pkce") return json(route, { ...session(), user });
        calls.password.push(body ?? {});
        return body?.password === (opts.password ?? "correct-horse")
          ? json(route, session())
          : json(route, { code: "invalid_credentials", error_code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
      case "/auth/v1/user":
        if (req.method() === "PUT") calls.updateUser.push(body ?? {});
        return json(route, user);
      case "/auth/v1/logout":
        calls.logout.push(url.searchParams.get("scope") ?? "");
        return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    }
    const table = url.pathname.replace("/rest/v1/", "") as keyof Tables;
    if (table in tables) {
      const rows = tables[table] as Record<string, unknown>[];
      const strip = ({ user_id: _u, ...r }: Record<string, unknown>) => r;
      if (req.method() === "GET") return json(route, rows);
      if (req.method() === "DELETE") {
        const eq = [...url.searchParams].filter(([k, v]) => k !== "user_id" && v.startsWith("eq."));
        const keep = rows.filter((r) => !eq.every(([k, v]) => String(r[k]) === v.slice(3)));
        rows.splice(0, rows.length, ...keep);
        return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
      }
      // An upsert: insert, or merge into the row with the same key.
      const sent = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
      const out = sent.map((row) => {
        const r = strip(row);
        const i = rows.findIndex((x) => KEYS[table].every((k) => x[k] === r[k]));
        if (i < 0) return rows[rows.push(r) - 1]!;
        return (rows[i] = mergeRow(table, rows[i]!, r));
      });
      const single = req.headers()["accept"]?.includes("vnd.pgrst.object");
      return json(route, single ? out[0] : out, 201);
    }
    if (url.pathname.startsWith("/auth/v1/user/identities/") && req.method() === "DELETE") {
      const id = url.pathname.split("/").pop()!;
      calls.unlinked.push(id);
      user = { ...user, identities: user.identities.filter((i) => (i as { identity_id?: string; id: string }).identity_id !== id && i.id !== id) };
      return json(route, {});
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

test("first GitHub sign-in: choose a username, then back to the page", async ({ page }) => {
  const github = {
    ...USER,
    id: "22222222-2222-4333-8444-555555555555",
    email: "octo@example.com",
    user_metadata: { user_name: "octocat", full_name: "The Octocat" } as never,
    app_metadata: { provider: "github", providers: ["github"] },
    identities: [{ id: "g1", provider: "github" }],
  };
  const calls = await fakeSupabase(page, { providers: ["github", "google"], profile: { username: "player-4821936", username_chosen: false }, oauthUser: github, takenNames: ["octocat"] });
  await page.goto(at("/en/bots/"));
  await page.getByRole("link", { name: "Log in" }).click();
  // Only the providers switched on in the project, in a fixed order.
  await expect(page.locator(".providers .provider")).toHaveText(["Continue with Google", "Continue with GitHub"]);
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(page.getByRole("heading", { name: "Choose your username" })).toBeVisible();
  expect(calls.authorize).toEqual(["github"]);
  // "octocat" is taken, so a variant is suggested.
  await expect(page.getByLabel("Username")).toHaveValue(/^octocat\d{3}$/);
  await page.getByLabel("Username").fill("octo_xq");
  await page.getByRole("button", { name: "Save username" }).click();
  await expect(page).toHaveURL(/\/en\/bots\/$/);
  await expect(page.getByRole("button", { name: /octo_xq/ })).toBeVisible();
  expect(calls.profileUpdates).toEqual([{ username: "octo_xq" }]);
});

test("settings: connect and disconnect a sign-in method", async ({ page }) => {
  const calls = await fakeSupabase(page, { providers: ["github", "azure"] });
  await page.goto(at("/en/auth/callback/?token_hash=abc&type=signup"));
  await expect(page.getByText(/signed in as Alice_1/)).toBeVisible();
  await page.goto(at("/en/settings/"));
  const linked = page.locator(".linked-sign-ins");
  await expect(linked.locator("li")).toHaveText([/Email and password/, /Microsoft\s*Connect/, /GitHub\s*Connect/]);
  await linked.locator("li", { hasText: "GitHub" }).getByRole("button", { name: "Connect" }).click();
  // Back on Settings after the provider, now connected.
  await expect(page).toHaveURL(/\/en\/settings\/$/);
  await expect(linked.locator("li", { hasText: "GitHub" })).toContainText("alice@users.example");
  expect(calls.authorize).toEqual(["link:github"]);
  await linked.locator("li", { hasText: "GitHub" }).getByRole("button", { name: "Disconnect" }).click();
  await expect(linked.locator("li", { hasText: "GitHub" }).getByRole("button", { name: "Connect" })).toBeVisible();
  expect(calls.unlinked).toEqual(["i-github"]);
});

test("a cancelled provider sign-in says so", async ({ page }) => {
  await fakeSupabase(page);
  await page.goto(at("/en/auth/callback/?error=access_denied&error_description=The+user+denied+the+request"));
  await expect(page.locator(".form-error")).toHaveText("Sign-in was cancelled.");
});

// M11: a signed-in browser syncs progress and settings with the account.

/** Writes guest progress the way the site stores it (IndexedDB and localStorage). */
async function seedGuest(page: Page) {
  await page.evaluate(async () => {
    const put = (db: string, store: string, key: string, value: unknown) =>
      new Promise<void>((done, fail) => {
        const r = indexedDB.open(db);
        r.onupgradeneeded = () => r.result.createObjectStore(store);
        r.onerror = () => fail(r.error);
        r.onsuccess = () => {
          const tx = r.result.transaction(store, "readwrite");
          tx.objectStore(store).put(value, key);
          tx.oncomplete = () => {
            r.result.close();
            done();
          };
        };
      });
    await put("xq-v1-lessons", "lessons", "progress", { "the-board": "mastered", "the-general": "started" });
    await put("xq-v1-bots", "bots", "stars", { xiaobing: 2 });
    localStorage.setItem("xq:daily:v1", JSON.stringify(["2026-10-01"]));
  });
}

const lessonsMastered = (page: Page) => page.locator(".tick");

test("signing in moves guest progress into the account; signing out leaves an empty guest", async ({ page }) => {
  const calls = await fakeSupabase(page);
  await page.goto(at("/en/learn/"));
  await seedGuest(page);
  await page.reload();
  await expect(lessonsMastered(page)).toHaveCount(1);

  await page.getByRole("link", { name: "Log in" }).click();
  await page.getByLabel("Email").fill("alice@example.com");
  await page.getByLabel("Password", { exact: true }).fill("correct-horse");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your progress from this browser is now saved to your account: 2 lessons." })).toBeVisible();
  await expect(lessonsMastered(page)).toHaveCount(1);

  await expect.poll(() => calls.tables.lesson_progress.map((r) => `${r.lesson_id}:${r.status}`).sort()).toEqual(["the-board:mastered", "the-general:started"]);
  await expect.poll(() => Object.fromEntries(calls.tables.player_state.map((r) => [r.key, r.value]))).toEqual({ stars: { xiaobing: 2 }, daily: ["2026-10-01"] });
  // A new account takes this browser's settings.
  await expect.poll(() => calls.tables.settings[0]?.data).toMatchObject({ notation: "wxf" });

  // Signed out: the account's progress is gone from this browser, and the guest copy was moved.
  await page.getByRole("button", { name: /Alice_1/ }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".learn-side")).toContainText("0/11 lessons mastered");
  await expect(lessonsMastered(page)).toHaveCount(0);
});

test("a signed-in browser shows the account's progress and settings from another device", async ({ page }) => {
  const calls = await fakeSupabase(page, {
    tables: {
      lesson_progress: [{ lesson_id: "the-horse", status: "mastered" }],
      settings: [{ data: { notation: "iccs", pieceSet: "icons" } }],
    },
  });
  await page.goto(at("/en/auth/callback/?token_hash=abc123&type=signup"));
  await expect(page.getByText(/signed in as Alice_1/)).toBeVisible();
  // Nothing to import: no welcome note.
  await page.goto(at("/en/learn/"));
  await expect(page.getByRole("button", { name: /Alice_1/ })).toBeVisible();
  await expect(lessonsMastered(page)).toHaveCount(1);
  await expect(page.locator(".sync-notice")).toHaveCount(0);

  await page.goto(at("/en/settings/"));
  const notation = page.getByLabel("Notation");
  await expect(notation).toHaveValue("iccs");
  await expect(page.getByRole("combobox", { name: /^Pieces/ })).toHaveValue("icons");
  // A change here follows the account to other devices.
  await notation.selectOption("wxf");
  await expect.poll(() => calls.tables.settings[0]?.data).toMatchObject({ notation: "wxf", pieceSet: "icons" });
});
