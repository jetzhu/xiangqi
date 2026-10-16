import { type BrowserContext, type Page, type Route, expect, test } from "@playwright/test";
import { at, play } from "./helpers.js";

// Play a friend (M16), end to end: two tabs of one browser are the two players. Supabase is a
// fake shared by both tabs; the two browsers set up their link over a BroadcastChannel instead
// of Realtime (window.__xqTabSignaling), and then play over a real WebRTC data channel, or over
// that channel as the relay.
test.use({ serviceWorkers: "block" });

const SUPABASE = "https://cxawhlamdwgojfzzgvqy.supabase.co";
const GAME = "99999999-8888-4777-8666-555555555555";
const CODE = "K7Q2MX";

function session(id: string, username: string) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id, aud: "authenticated", role: "authenticated", email: `${username}@example.com`, email_confirmed_at: "2026-10-07T00:00:00Z",
    user_metadata: { username }, app_metadata: { provider: "email", providers: ["email"] }, identities: [{ id: "i1", provider: "email" }], created_at: "2026-10-07T00:00:00Z",
  };
  return { access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: id, exp, role: "authenticated", aud: "authenticated" })}.sig`, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user };
}

/** The server both tabs talk to: one challenge, one game, the reports each browser sent. */
function world(relay: boolean) {
  return {
    relay,
    challenge: null as null | { base: number; inc: number; color: string; rated: boolean; game: string | null },
    reports: [] as { by: "red" | "black"; report: { kind: string; ply?: number; iccs?: string; result?: { winner: string | null; reason: string } } }[],
    settled: 0,
  };
}
type World = ReturnType<typeof world>;

/** Signs a tab in as one player and answers its calls; `color` is the side it gets in the game. */
async function player(page: Page, w: World, who: { id: string; username: string; color: "red" | "black" }) {
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body, headers: { "access-control-allow-origin": "*" } });
  const players = { red: { username: "alice_xq", avatar: null, rating: 1200, rd: 80 }, black: { username: "bob_xq", avatar: null, rating: 1150, rd: 150 } };
  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const body = req.postDataJSON() as Record<string, unknown> | null;
    switch (url.pathname) {
      case "/auth/v1/verify":
      case "/auth/v1/token":
        return json(route, session(who.id, who.username));
      case "/auth/v1/user":
        return json(route, session(who.id, who.username).user);
      case "/rest/v1/profiles":
        return json(route, [{ username: who.username, username_chosen: true, avatar: null, country: null }]);
      case "/rest/v1/rpc/online_eligibility":
        return json(route, { verified: true, age_answered: true, under16: false, level: 1200, target: 1200, clean_win: true, long_games: 3, casual_ok: true, eligible: true });
      case "/rest/v1/rpc/create_challenge":
        w.challenge = { base: body!.p_base as number, inc: body!.p_inc as number, color: body!.p_color as string, rated: body!.p_rated as boolean, game: null };
        return json(route, CODE);
      case "/rest/v1/rpc/challenge_info": {
        const c = w.challenge;
        if (!c || String(body?.p_code).toUpperCase() !== CODE) return json(route, null);
        return json(route, { code: CODE, from: "alice_xq", mine: who.color === "red", rating: 1200, base: c.base, inc: c.inc, color: c.color, rated: c.rated, expired: false, game: c.game, taken: c.game !== null });
      }
      case "/rest/v1/rpc/accept_challenge":
        w.challenge!.game = GAME;
        return json(route, GAME);
      case "/rest/v1/rpc/game_info": {
        const c = w.challenge!;
        return json(route, {
          id: GAME, me: who.color, red: players.red, black: players.black, base: c.base, inc: c.inc, speed: "lightning", rated: c.rated, relay: w.relay,
          status: "playing", result: null, reason: null, moves: [], red_rating_before: null, red_rating_after: null, black_rating_before: null, black_rating_after: null,
        });
      }
      case "/rest/v1/rpc/report_game":
        w.reports.push({ by: who.color, report: body!.p_report as World["reports"][number]["report"] });
        return json(route, null);
      case "/functions/v1/game": {
        w.settled++;
        const end = w.reports.find((r) => r.report.kind === "end");
        if (!end) return json(route, { status: "playing", pending: "no end report yet" });
        const result = end.report.result!;
        const up = (n: number) => ({ before: n, after: n + (result.winner === null ? 0 : 9) });
        const down = (n: number) => ({ before: n, after: n - 9 });
        return json(route, { status: "over", result, rated: true, ratings: { red: result.winner === "red" ? up(1200) : down(1200), black: result.winner === "black" ? up(1150) : down(1150) } });
      }
    }
    // Players who can play online have played bots, so they have a bot rating (and the skill question isn't asked).
    if (url.pathname === "/rest/v1/ratings" && req.method() === "GET")
      return json(route, [{ kind: "bot", rating: 1200, rd: 80, games: 12, peak: null, peak_at: null, last_played: null }]);
    // The other synced tables: nothing stored.
    if (url.pathname.startsWith("/rest/v1/")) return req.method() === "GET" ? json(route, []) : route.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" } });
    return json(route, {});
  });
}

let traces: string[] = [];
test.beforeEach(() => void (traces = []));
test.afterEach(({}, info) => {
  if (info.status !== info.expectedStatus) console.log(traces.join("\n"));
});

async function twoPlayers(context: BrowserContext, relay: boolean) {
  await context.addInitScript(() => ((window as { __xqTabSignaling?: boolean }).__xqTabSignaling = true));
  const w = world(relay);
  const alice = await context.newPage();
  const bob = await context.newPage();
  // What each tab's link did, printed if the test fails.
  for (const [name, p] of [["alice", alice], ["bob", bob]] as const) {
    p.on("console", (m) => m.type() === "debug" && traces.push(`${Date.now() % 100_000} ${name} ${m.text()}`));
  }
  await player(alice, w, { id: "aaaaaaaa-0000-4000-8000-000000000001", username: "alice_xq", color: "red" });
  await player(bob, w, { id: "bbbbbbbb-0000-4000-8000-000000000002", username: "bob_xq", color: "black" });
  // Each tab signs in (the session is stored per origin, so the second sign-in wins for new loads; the fakes don't mind).
  for (const p of [alice, bob]) {
    await p.goto(at("/en/auth/callback/?token_hash=abc123&type=signup"));
    await expect(p.getByText(/signed in as/)).toBeVisible();
  }
  return { w, alice, bob };
}

async function startGame(alice: Page, bob: Page) {
  await alice.goto(at("/en/friend/"));
  await alice.getByRole("button", { name: "2+1" }).click();
  await alice.getByRole("radio", { name: "Red" }).click();
  await alice.getByRole("button", { name: "Create challenge link" }).click();
  await expect(alice.getByLabel("Challenge code")).toHaveText(CODE);
  await expect(alice.getByLabel("Challenge link")).toHaveValue(new RegExp(`/en/challenge/\\?c=${CODE}$`));

  await bob.goto(at(`/en/challenge/?c=${CODE.toLowerCase()}`));
  await expect(bob.getByRole("heading", { name: "alice_xq challenges you" })).toBeVisible();
  await expect(bob.getByText("you play Black")).toBeVisible();
  await bob.getByRole("button", { name: "Accept and play" }).click();
  await expect(bob).toHaveURL(new RegExp(`/en/game/\\?id=${GAME}`));
  // The challenger's page notices and opens the game.
  await expect(alice).toHaveURL(new RegExp(`/en/game/\\?id=${GAME}`), { timeout: 10_000 });
}

for (const relay of [false, true]) {
  test(`play a friend over ${relay ? "the relay" : "a direct link"}: moves, clocks, chat, resign, rated result`, async ({ context }) => {
    const { w, alice, bob } = await twoPlayers(context, relay);
    await startGame(alice, bob);

    await expect(alice.getByText(relay ? "Relayed" : /Connected|\d+ ms/).first()).toBeVisible({ timeout: 15_000 });
    await expect(alice.getByRole("status")).toContainText("Your move");
    await expect(bob.getByRole("status")).toContainText("Opponent's move");
    await expect(alice.getByText(/Make your first move/)).toBeVisible();

    const moves = ["h2e2", "h9g7", "h0g2", "i9h9"];
    await play(alice, "h2e2");
    await expect(bob.getByRole("status")).toContainText("Your move");
    await play(bob, "h9g7");
    await expect(alice.getByRole("status")).toContainText("Your move");
    // Bob queues his reply while Alice thinks (a premove, Lightning); it's played as soon as she moves.
    await play(bob, "i9h9");
    await expect(bob.getByText("Premove queued.")).toBeVisible();
    await play(alice, "h0g2");
    await expect(alice.getByRole("status")).toContainText("Your move");
    await expect(bob.getByText("Premove queued.")).toHaveCount(0);
    // Both move lists agree, and Alice's clock runs on her turn.
    for (const p of [alice, bob]) await expect(p.locator("ol.moves li")).toHaveCount(2);
    const aliceClock = alice.getByRole("timer", { name: "Clock" }).last();
    const before = await aliceClock.textContent();
    await alice.waitForTimeout(1_200);
    expect(await aliceClock.textContent()).not.toBe(before);

    // A chat phrase arrives on the other side.
    await bob.getByRole("button", { name: "Good luck" }).click();
    await expect(alice.locator(".bubble")).toHaveText("Good luck");

    // Rated: no takebacks; draws only after 10 moves each.
    await expect(alice.getByRole("button", { name: "Takeback" })).toHaveCount(0);
    await expect(alice.getByRole("button", { name: "Offer draw" })).toBeDisabled();

    await alice.getByRole("button", { name: "Resign" }).click();
    await alice.getByRole("button", { name: "Confirm resign?" }).click();
    await expect(alice.getByRole("heading", { name: "You lost" })).toBeVisible();
    await expect(bob.getByRole("heading", { name: "You won!" })).toBeVisible();
    await expect(bob.getByRole("region", { name: "Game over" })).toContainText("Red resigned");
    await expect(bob.locator(".rating-line")).toContainText("1150 → 1159");
    await expect(alice.locator(".rating-line")).toContainText("1200 → 1191");

    // Every move went to the server from both browsers, then both end reports.
    const moveReports = w.reports.filter((r) => r.report.kind === "move");
    expect(moveReports.filter((r) => r.by === "red").map((r) => r.report.iccs)).toEqual(moves);
    expect(moveReports.filter((r) => r.by === "black").map((r) => r.report.iccs)).toEqual(moves);
    expect(w.reports.filter((r) => r.report.kind === "end").map((r) => r.report.result)).toEqual([
      { winner: "black", reason: "resign" },
      { winner: "black", reason: "resign" },
    ]);
    expect(w.settled).toBeGreaterThan(0);
  });
}

test("a casual game allows takebacks and early draws", async ({ context }) => {
  const { alice, bob } = await twoPlayers(context, false);
  await alice.goto(at("/en/friend/"));
  await alice.getByRole("button", { name: "2+1" }).click();
  await alice.getByRole("radio", { name: "Red" }).click();
  await alice.getByRole("radio", { name: "Casual" }).click();
  await alice.getByRole("button", { name: "Create challenge link" }).click();
  await bob.goto(at(`/en/challenge/?c=${CODE}`));
  await bob.getByRole("button", { name: "Accept and play" }).click();
  await expect(alice).toHaveURL(/\/en\/game\//, { timeout: 10_000 });
  await expect(alice.getByRole("status")).toContainText("Your move", { timeout: 15_000 });

  await play(alice, "h2e2");
  await expect(bob.getByRole("status")).toContainText("Your move");
  await play(bob, "h9g7");
  await expect(alice.getByRole("status")).toContainText("Your move");
  await play(alice, "h0g2");
  await expect(bob.getByRole("status")).toContainText("Your move");

  // Alice takes back her last move; Bob agrees.
  await alice.getByRole("button", { name: "Takeback" }).click();
  await expect(bob.getByText("Your opponent asks to take back a move.")).toBeVisible();
  await bob.getByRole("button", { name: "Accept" }).click();
  await expect(alice.getByRole("status")).toContainText("Your move");
  for (const p of [alice, bob]) await expect(p.locator("ol.moves li")).toHaveCount(1);

  // A draw offer, accepted.
  await alice.getByRole("button", { name: "Offer draw" }).click();
  await expect(bob.getByText("Your opponent offers a draw.")).toBeVisible();
  await bob.getByRole("button", { name: "Accept" }).click();
  for (const p of [alice, bob]) await expect(p.getByRole("heading", { name: "Draw" })).toBeVisible();
});

test("the analysis board is off while a game is in progress", async ({ context }) => {
  const { alice, bob } = await twoPlayers(context, false);
  await startGame(alice, bob);
  await expect(alice.getByRole("status")).toContainText("Your move", { timeout: 15_000 });
  const third = await context.newPage();
  await third.goto(at("/en/analysis/"));
  await expect(third.getByText("Analysis is off while you have a game in progress.")).toBeVisible();
});

test("a reloaded page gets the game back from the opponent's browser and carries on", async ({ context }) => {
  const { alice, bob } = await twoPlayers(context, false);
  await startGame(alice, bob);
  await expect(alice.getByRole("status")).toContainText("Your move", { timeout: 15_000 });
  await play(alice, "h2e2");
  await expect(bob.getByRole("status")).toContainText("Your move");
  await play(bob, "h9g7");
  await expect(alice.getByRole("status")).toContainText("Your move");

  await bob.reload();
  await expect(bob.locator("ol.moves li")).toHaveCount(1, { timeout: 20_000 });
  await expect(bob.locator("ol.moves")).toContainText(/C2.5|炮二平五|h2e2/);
  await play(alice, "h0g2");
  await expect(bob.getByRole("status")).toContainText("Your move");
  await play(bob, "i9h9");
  await expect(alice.getByRole("status")).toContainText("Your move");
  for (const p of [alice, bob]) await expect(p.locator("ol.moves li")).toHaveCount(2);
});
