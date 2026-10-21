import { type BrowserContext, type Page, type Route, expect, test } from "@playwright/test";
import { at, play } from "./helpers.js";

// Play a friend (M16) and quick pairing (M17), end to end: two tabs of one browser are the two players. Supabase is a
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
    /** Quick pairing: each tab's seek, a "Play anyway" invitation, and whether the two are out of range. */
    seeks: {} as Partial<Record<"red" | "black", { base: number; inc: number; matched: boolean }>>,
    invite: false,
    far: false,
    /** What find_match says the searcher's own filters leave out. */
    excluded: null as null | Record<string, number>,
    sport: { completion: null, last30: { games: 0, abandoned: 0, stalled: 0, aborted: 0, slow_start: 0 }, warning: false, wait_until: null, pool: false },
    calls: [] as string[],
    /** M19: notices, a sanction, the leaderboard, and whether the player is a moderator. */
    notices: [] as { id: number; kind: string; data: object; at: string }[],
    sanction: null as null | object,
    board: [] as { rank: number; username: string; rating: number; games: number }[],
    moderator: false,
    /** M21: feedback sent and filed, and the Support page's donation links. */
    feedback: [] as { id: number; at: string; kind: string; message: string; page: string | null; version: string | null; lang: string | null; status: string; note: string | null; username: string | null; reply_to: string | null }[],
    donations: { stripe: null as string | null, github: null as string | null },
    /** M22: automatic steps, the category switches, the daily summary, and a paused chat. */
    steps: [] as { id: number; at: string; source: string; kind: string; category: string; verdict: string; confidence: number; reason: string; details: object; review: string | null; reviewed_at: string | null; review_note: string | null; reviewed_by: string | null; target: string; report: number; report_note: string | null; reporter: string; game: string }[],
    switches: [] as { category: string; on: boolean; pending: number; reviewed: number; undone: number }[],
    digest: null as null | { id: number; at: string; source: string; summary: string },
    blackMutedUntil: null as string | null,
    /** M23: each player's coaching page, and what a request answers (an error hint, or a status). */
    coaching: {} as Record<string, object>,
    requestAnswer: { status: "guardian" } as { status?: string; hint?: string },
    contact: { name: "Xiangqi School 象棋学堂", address: "P.O. Box 10000, Cupertino, CA 95014, USA", phone: null as string | null, email: "jianjetzhu@gmail.com" },
    /** Fair-play analyses each browser sent after the game (M18). */
    analyses: [] as { by: "red" | "black"; analysis: { v: number; depth: number; positions: { b: string | null; s: number[] }[] } }[],
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
        return json(route, { verified: true, age_answered: true, under16: false, level: 1200, target: 1200, clean_win: true, long_games: 3, casual_ok: true, eligible: !w.sanction, sanction: w.sanction });
      case "/rest/v1/rpc/report_player":
        w.calls.push(`report:${body!.p_reason}:${body!.p_note}`);
        return json(route, null);
      case "/rest/v1/rpc/reported_game":
        return json(route, w.calls.some((c) => c.startsWith("report:")));
      case "/rest/v1/rpc/my_notices":
        return json(route, w.notices);
      case "/rest/v1/rpc/dismiss_notice":
        w.calls.push(`dismiss:${body!.p_id}`);
        w.notices = w.notices.filter((n) => n.id !== body!.p_id);
        return json(route, null);
      case "/rest/v1/rpc/leaderboard":
        return json(route, body!.p_speed === "blitz" ? w.board : []);
      case "/rest/v1/rpc/is_moderator":
        return json(route, w.moderator);
      case "/rest/v1/rpc/mod_queue":
        return json(route, [{ username: "bob_xq", rating: 1150, score: 5.4, verdict: "likely", reports: 2, weight: 1.2, unchecked: 1, priority: 20, last_outcome: "inconclusive", last_note: "too few games", last_reviewed: "2026-10-10T00:00:00Z", triage: { valid: 1, invalid: 0, inconclusive: 1 } }]);
      case "/rest/v1/rpc/site_contact":
        return json(route, w.contact);
      case "/rest/v1/rpc/mod_set_contact":
        w.contact = { name: body!.p_name as string, address: body!.p_address as string, phone: body!.p_phone as string | null, email: body!.p_email as string };
        w.calls.push(`contact:${body!.p_note}`);
        return json(route, null);
      case "/rest/v1/rpc/send_feedback":
        w.feedback.push({ id: w.feedback.length + 1, at: "2026-10-21T10:00:00Z", kind: body!.p_kind as string, message: body!.p_message as string, page: body!.p_page as string, version: body!.p_version as string, lang: body!.p_lang as string, status: "new", note: null, username: who.username, reply_to: body!.p_may_reply ? `${who.username}@example.com` : null });
        return json(route, null);
      case "/rest/v1/rpc/mod_feedback":
        return json(route, w.feedback.filter((f) => (body!.p_status ? f.status === body!.p_status : ["new", "noted", "planned"].includes(f.status))));
      case "/rest/v1/rpc/mod_feedback_counts":
        return json(route, Object.fromEntries(["new", "noted", "planned", "done", "wontdo"].map((st) => [st, w.feedback.filter((f) => f.status === st).length])));
      case "/rest/v1/rpc/mod_set_feedback": {
        const f = w.feedback.find((x) => x.id === body!.p_id)!;
        f.status = body!.p_status as string;
        f.note = body!.p_note as string | null;
        w.calls.push(`feedback:${f.id}:${f.status}:${f.note}`);
        return json(route, null);
      }
      case "/rest/v1/rpc/site_donations":
        return json(route, w.donations);
      case "/rest/v1/rpc/mod_set_donations":
        w.donations = { stripe: body!.p_stripe as string | null, github: body!.p_github as string | null };
        w.calls.push(`donations:${body!.p_note}`);
        return json(route, null);
      case "/rest/v1/rpc/my_coaching":
        return json(route, w.coaching[who.username] ?? { needs_guardian: false, coach_problem: null, as_student: [], visits: [], requests: [], students: [], codes: [] });
      case "/rest/v1/rpc/request_coach":
        w.calls.push(`request:${body!.p_coach}:${body!.p_code}:${body!.p_family}:${body!.p_guardian_email}`);
        if (w.requestAnswer.hint) return json(route, { code: "P0001", message: "no", hint: w.requestAnswer.hint }, 400);
        return json(route, { id: 1, status: w.requestAnswer.status, coach: body!.p_coach });
      case "/rest/v1/rpc/coach_answer":
        w.calls.push(`answer:${body!.p_link}:${body!.p_accept}`);
        return json(route, "active");
      case "/rest/v1/rpc/create_coach_code":
        w.calls.push("code");
        return json(route, { code: "K7Q2MXAB", expires_at: "2026-10-22T10:00:00Z" });
      case "/rest/v1/rpc/coach_student_games":
        return json(route, [
          { id: GAME, ended_at: "2026-10-20T10:00:00Z", speed: "blitz", base: 300, inc: 3, rated: true, color: "red", opponent: null, opponent_under16: true, result: "win", reason: "resign", plies: 40, rating_before: 1150, rating_after: 1158 },
        ]);
      case "/rest/v1/rpc/coach_game_info":
        w.calls.push(`coach-open:${body!.p_game}`);
        return json(route, {
          id: GAME, me: null, coach_of: "red", red: { username: "bob_xq", avatar: null, rating: 1158, rd: 80 }, black: { username: null, avatar: null, rating: null, rd: null, under16: true },
          base: 300, inc: 3, speed: "blitz", rated: true, relay: true, status: "over", result: "red", reason: "resign", moves: ["h2e2", "h9g7"],
          red_rating_before: 1150, red_rating_after: 1158, black_rating_before: null, black_rating_after: null, ended_at: "2026-10-20T10:00:00Z",
        });
      case "/rest/v1/rpc/mod_latest_digest":
        return json(route, w.digest);
      case "/rest/v1/rpc/mod_auto_actions":
        return json(route, w.steps.filter((st) => (body!.p_pending ? st.review === null : st.review !== null)));
      case "/rest/v1/rpc/mod_review_auto": {
        const st = w.steps.find((x) => x.id === body!.p_id)!;
        st.review = body!.p_keep ? "kept" : "undone";
        st.review_note = body!.p_note as string | null;
        st.reviewed_by = who.username;
        st.reviewed_at = "2026-10-21T12:00:00Z";
        w.calls.push(`review:${st.id}:${st.review}:${st.review_note}`);
        return json(route, null);
      }
      case "/rest/v1/rpc/mod_triage_switches":
        return json(route, w.switches);
      case "/rest/v1/rpc/mod_set_auto": {
        w.switches.find((x) => x.category === body!.p_category)!.on = body!.p_on as boolean;
        w.calls.push(`auto:${body!.p_category}:${body!.p_on}:${body!.p_note}`);
        return json(route, null);
      }
      case "/rest/v1/rpc/triage_agreement":
        return json(route, [{ source: "rules", category: "stalling", decisions: 20, agreed: 19, confident: 18, confident_agreed: 18 }]);
      case "/rest/v1/rpc/mod_log_recent":
        return json(route, [{ at: "2026-10-18T10:00:00Z", action: "dismiss", details: { note: "no evidence" }, moderator: "alice_xq", target: "carol_xq" }]);
      case "/rest/v1/rpc/mod_case":
        return json(route, {
          username: "bob_xq", created_at: "2026-10-01T00:00:00Z", report_barred: false, reporter: { made: 0, upheld: 0, weight: 0.5 }, completion: 100, checked_games: 12,
          ratings: { blitz: { rating: 1150, rd: 80, games: 40 } }, standing: { blitz: { games: 12, score: 5.4, far: 4, verdict: "likely" } }, sanctions: [],
          reports: [{ id: 1, game: GAME, reason: "engine", note: "every move instant", at: "2026-10-18T09:00:00Z", status: "open", reporter: "alice_xq", record: { made: 3, upheld: 2, weight: 0.6 },
            triage: [
              { source: "rules", verdict: "valid", confidence: 0.9, rule: "standing-likely", reason: "Fair-play standing at this speed is \"likely\".", at: "2026-10-18T09:00:00Z" },
              { source: "ai:claude-code", verdict: "valid", confidence: 0.75, rule: "sonnet", reason: "Accuracy far above the rating band in 12 games.", at: "2026-10-18T10:00:00Z" },
            ] }],
          games: [{ id: GAME, speed: "blitz", base: 300, inc: 3, color: "black", opponent: "alice_xq", result: "black", reason: "resign", plies: 60, ended_at: "2026-10-18T09:00:00Z", rating_before: 1140, status: "checked", labels: ["aborted"], moves: null,
            chat: { red: [{ ply: 30, by: "black", phrase: "oops" }], black: [{ ply: 30, by: "black", phrase: "oops" }, { ply: 31, by: "black", phrase: "oops" }] },
            check: { moves: 22, acc: 97.5, match: 0.82, z: 3.9, flags: ["even-times"], timing: { cv: 0.18, fast: 0.05, focus: 0, hard_ratio: 1.02 } } }],
          log: [], review: { outcome: "inconclusive", at: "2026-10-10T00:00:00Z", note: "too few games" },
        });
      case "/rest/v1/rpc/mod_excuse_label":
        w.calls.push(`excuse:${body!.p_username}:${body!.p_label}:${body!.p_note}`);
        return json(route, null);
      case "/rest/v1/rpc/mod_reset_sportsmanship":
        w.calls.push(`reset:${body!.p_username}:${body!.p_note}`);
        return json(route, null);
      case "/rest/v1/rpc/mod_dismiss":
      case "/rest/v1/rpc/mod_inconclusive":
      case "/rest/v1/rpc/mod_confirm":
        w.calls.push(`${url.pathname.split("/").pop()}:${body!.p_username}:${body!.p_note}`);
        return json(route, url.pathname.endsWith("confirm") ? { level: 1, sanction: 1, refunded_games: 3 } : null);
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
          id: GAME, me: who.color, red: players.red, black: { ...players.black, chat_muted_until: w.blackMutedUntil }, base: c.base, inc: c.inc, speed: "lightning", rated: c.rated, relay: w.relay,
          status: "playing", result: null, reason: null, moves: [], red_rating_before: null, red_rating_after: null, black_rating_before: null, black_rating_after: null,
        });
      }
      case "/rest/v1/rpc/my_sportsmanship":
        return json(route, w.sport);
      case "/rest/v1/rpc/acknowledge_sportsmanship":
        w.calls.push("acknowledge");
        w.sport = { ...w.sport, warning: false };
        return json(route, null);
      case "/rest/v1/rpc/seek_counts":
        return json(route, { "120+1": Object.keys(w.seeks).length });
      case "/rest/v1/rpc/seek":
        w.calls.push(`seek:${who.color}:${body!.p_base}+${body!.p_inc}:${JSON.stringify(body!.p_filters)}`);
        w.seeks[who.color] = { base: body!.p_base as number, inc: body!.p_inc as number, matched: false };
        return json(route, null);
      case "/rest/v1/rpc/cancel_seek":
        // As the database does: a matched seek stays until find_match hands over the game.
        if (!w.seeks[who.color]?.matched) delete w.seeks[who.color];
        return json(route, null);
      case "/rest/v1/rpc/invite_seeker":
        w.invite = true;
        return json(route, true);
      case "/rest/v1/rpc/answer_invite": {
        w.invite = false;
        if (!body!.p_accept) return json(route, null);
        const mine = w.seeks[who.color]!;
        w.challenge = { base: mine.base, inc: mine.inc, color: "red", rated: true, game: GAME };
        w.seeks.red!.matched = true;
        w.seeks.black!.matched = true;
        delete w.seeks[who.color];
        return json(route, GAME);
      }
      case "/rest/v1/rpc/find_match": {
        const mine = w.seeks[who.color];
        const theirs = w.seeks[who.color === "red" ? "black" : "red"];
        if (!mine) return json(route, { status: "idle" });
        if (mine.matched || (theirs && !w.far)) {
          w.challenge = { base: mine.base, inc: mine.inc, color: "red", rated: true, game: GAME };
          if (theirs) theirs.matched = true;
          delete w.seeks[who.color];
          return json(route, { status: "matched", game: GAME });
        }
        const other = who.color === "red" ? { username: "bob_xq", rating: 1500, diff: 300 } : { username: "alice_xq", rating: 1200, diff: -300 };
        return json(route, {
          status: "searching", window: 50, anyone: false, waited: 3, counts: { "120+1": Object.keys(w.seeks).length },
          nearest: theirs ? [{ ...other, waited: 3, invited: w.invite && who.color === "red" }] : [],
          ...(w.excluded ? { excluded: w.excluded } : {}),
          invite: w.invite && who.color === "black" ? { id: 7, rating: 1200, diff: -300, expires_in: 12 } : null,
        });
      }
      case "/rest/v1/rpc/report_game":
        w.reports.push({ by: who.color, report: body!.p_report as World["reports"][number]["report"] });
        return json(route, null);
      case "/functions/v1/game": {
        if (body?.analysis) {
          w.analyses.push({ by: who.color, analysis: body.analysis as World["analyses"][number]["analysis"] });
          return json(route, { fairplay: w.analyses.length === 2 ? "checked" : "one" });
        }
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

test("quick pairing: two players seeking on a tile are paired and the game opens", async ({ context }) => {
  const { w, alice, bob } = await twoPlayers(context, false);
  await alice.goto(at("/en/online/"));
  await expect(alice.getByRole("heading", { name: "Quick pairing" })).toBeVisible();
  await alice.getByRole("button", { name: /^2\+1/ }).click();
  await expect(alice.getByRole("heading", { name: "Looking for an opponent: 2+1" })).toBeVisible();
  await expect(alice.getByText("Within ±50 of your rating")).toBeVisible();
  expect(w.calls).toEqual([`seek:red:120+1:${JSON.stringify({ range: 200, established: false, account_age: 0, completion: 0, checked: false })}`]);

  await bob.goto(at("/en/online/"));
  await bob.getByRole("button", { name: /^2\+1/ }).click();
  await expect(bob).toHaveURL(new RegExp(`/en/game/\\?id=${GAME}`));
  await expect(alice).toHaveURL(new RegExp(`/en/game/\\?id=${GAME}`), { timeout: 10_000 });
  await expect(alice.getByText("bob_xq")).toBeVisible();
  await expect(bob.getByText("alice_xq")).toBeVisible();
});

test("quick pairing: play anyway with the nearest player outside the window", async ({ context }) => {
  const { w, alice, bob } = await twoPlayers(context, false);
  w.far = true;
  await alice.goto(at("/en/online/"));
  await alice.getByRole("button", { name: /^2\+1/ }).click();
  await bob.goto(at("/en/online/"));
  await bob.getByRole("button", { name: /^2\+1/ }).click();
  await expect(alice.getByText("bob_xq, 1500 (+300), waiting 3 s")).toBeVisible();
  await alice.getByRole("button", { name: "Play anyway" }).click();
  await expect(alice.getByText("Invited…")).toBeVisible();
  await expect(bob.getByText("A player rated 1200 (−300) is ready to play you.")).toBeVisible();
  await bob.getByRole("button", { name: "Accept" }).click();
  await expect(bob).toHaveURL(new RegExp(`/en/game/\\?id=${GAME}`));
  await expect(alice).toHaveURL(new RegExp(`/en/game/\\?id=${GAME}`), { timeout: 10_000 });
});

test("quick pairing says when the player's own filters leave others out", async ({ context }) => {
  const { w, alice } = await twoPlayers(context, false);
  w.excluded = { completion: 1 };
  await alice.goto(at("/en/settings/?tab=online"));
  await alice.getByLabel("Completion rate (棋品)").selectOption("95");
  await alice.goto(at("/en/online/"));
  await alice.getByRole("button", { name: /^2\+1/ }).click();
  await expect(alice.getByText("Your filters leave out players searching here: completion rate 95 %+: 1.")).toBeVisible();
  await alice.getByRole("link", { name: "Change filters" }).click();
  await expect(alice).toHaveURL(/\/en\/settings\/\?tab=online/);
});

test("a sportsmanship warning must be acknowledged before quick pairing", async ({ context }) => {
  const { w, alice } = await twoPlayers(context, false);
  w.sport = { ...w.sport, completion: 80 as never, last30: { ...w.sport.last30, games: 5, abandoned: 1 }, warning: true };
  await alice.goto(at("/en/online/"));
  await expect(alice.getByText("Completion rate: 80 % of your games in the last 90 days. In your last 30 games: left 1.")).toBeVisible();
  await expect(alice.getByRole("button", { name: /^2\+1/ })).toBeDisabled();
  await alice.getByRole("button", { name: "I understand" }).click();
  await expect(alice.getByRole("button", { name: /^2\+1/ })).toBeEnabled();
  expect(w.calls).toEqual(["acknowledge"]);
});

test("notices and a suspension show on the Play online page", async ({ context }) => {
  const { w, alice } = await twoPlayers(context, false);
  w.notices = [{ id: 4, kind: "refund", data: { points: 18, games: 2 }, at: "2026-10-18T10:00:00Z" }];
  w.sanction = { id: 1, level: 1, suspended_until: "2026-11-17T10:00:00Z", closed: false, appeal: "none", appeal_deadline: "2026-11-17T10:00:00Z" };
  await alice.goto(at("/en/online/"));
  await expect(alice.getByText("18 rating points from 2 game(s) have been given back to you.", { exact: false })).toBeVisible();
  await expect(alice.getByText("Rated online play is suspended until November 17, 2026", { exact: false })).toBeVisible();
  await expect(alice.getByRole("heading", { name: "Quick pairing" })).toHaveCount(0);
  await alice.getByRole("button", { name: "Dismiss" }).click();
  await expect(alice.getByText("have been given back to you", { exact: false })).toHaveCount(0);
  expect(w.calls).toContain("dismiss:4");
});

test("leaderboards list the top players by speed", async ({ context }) => {
  const { w, alice } = await twoPlayers(context, false);
  w.board = [{ rank: 1, username: "bob_xq", rating: 1650, games: 41 }];
  await alice.goto(at("/en/leaderboard/"));
  await expect(alice.getByRole("row", { name: "1 bob_xq 1650 41" })).toBeVisible();
  await alice.getByRole("tab", { name: "Rapid" }).click();
  await expect(alice.getByText("Nobody qualifies yet.")).toBeVisible();
});

test("the review page is for moderators: the queue, a case, and a decision", async ({ context }) => {
  const { w, alice, bob } = await twoPlayers(context, false);
  await bob.goto(at("/en/moderate/"));
  await expect(bob.getByText("This page is for moderators.")).toBeVisible();
  w.moderator = true;
  await alice.goto(at("/en/moderate/"));
  await expect(alice.getByRole("heading", { name: "Review queue" })).toBeVisible();
  await expect(alice.getByText("Returning: not conclusive", { exact: false })).toBeVisible();
  // Any player's case can be opened by name.
  await alice.getByLabel("Open a player's case").fill("bob_xq");
  await alice.getByRole("button", { name: "Open", exact: true }).click();
  await expect(alice).toHaveURL(/\/en\/moderate\/\?u=bob_xq/);
  await alice.goto(at("/en/moderate/"));
  await expect(alice.getByText("1 likely valid · 0 likely invalid · 1 inconclusive")).toBeVisible();
  await expect(alice.getByRole("row", { name: "rules stalling 19/20 (95 %) 18/18 (100 %)" })).toBeVisible();
  await alice.getByRole("link", { name: "bob_xq" }).click();
  await expect(alice.getByText("every move instant")).toBeVisible();
  await expect(alice.getByText("Last decision: not conclusive", { exact: false })).toBeVisible();
  // Each report with the rules' verdict and the AI adviser's beside it.
  await expect(alice.getByText("Rules: likely valid (0.90)", { exact: false })).toBeVisible();
  await expect(alice.getByText("AI: claude-code: likely valid (0.75)", { exact: false })).toBeVisible();
  // The chat as each browser recorded it: here they differ, which is itself evidence.
  await alice.getByText("Chat (2) · the two records differ").click();
  await expect(alice.getByText("Player's browser")).toBeVisible();
  // A sportsmanship mark can be excused, and the record reset, each with a reason.
  await expect(alice.getByRole("button", { name: "Excuse" })).toBeDisabled();
  await alice.getByLabel("Reason and evidence (kept in the log)").fill("test game");
  await alice.getByRole("button", { name: "Excuse" }).click();
  await expect(alice.getByText("Mark excused.")).toBeVisible();
  await alice.getByLabel("Reason and evidence (kept in the log)").fill("test games");
  await alice.getByRole("button", { name: "Reset sportsmanship record" }).click();
  await expect(alice.getByText("Sportsmanship record reset: only games from now count.")).toBeVisible();
  expect(w.calls).toEqual(expect.arrayContaining(["excuse:bob_xq:aborted:test game", "reset:bob_xq:test games"]));
  await alice.getByLabel("Reason and evidence (kept in the log)").fill("still only 12 games");
  await alice.getByRole("button", { name: "Not conclusive" }).click();
  await expect(alice.getByText("Kept open: back in the queue with new evidence.")).toBeVisible();
  expect(w.calls).toContain("mod_inconclusive:bob_xq:still only 12 games");
  await expect(alice.getByRole("cell", { name: "97.5" })).toBeVisible();
  await alice.getByLabel("Reason and evidence (kept in the log)").fill("engine match far above 1150 in 12 games");
  await alice.getByRole("button", { name: "Confirm violation…" }).click();
  await alice.getByRole("button", { name: "Confirm violation: sanction, refunds, public mark" }).click();
  await expect(alice.getByText("Violation confirmed.")).toBeVisible();
  expect(w.calls).toContain("mod_confirm:bob_xq:engine match far above 1150 in 12 games");
});

test("moderators keep the operator's contact block, which the privacy policy shows", async ({ context }) => {
  const { w, alice } = await twoPlayers(context, false);
  await alice.goto(at("/en/privacy/"));
  await expect(alice.locator(".operator-contact")).toContainText("P.O. Box 10000, Cupertino, CA 95014, USA");
  w.moderator = true;
  await alice.goto(at("/en/moderate/"));
  await alice.getByRole("link", { name: "Site settings" }).click();
  await alice.getByLabel("Postal address").fill("P.O. Box 77, Cupertino, CA 95015, USA");
  await alice.getByLabel("Phone (optional)").fill("+1 408 555 0100");
  await expect(alice.getByRole("button", { name: "Save contact" })).toBeDisabled();
  await alice.getByLabel("Reason (kept in the log)").last().fill("new PO box");
  await alice.getByRole("button", { name: "Save contact" }).click();
  await expect(alice.getByText("Saved: the privacy policy shows it now.")).toBeVisible();
  expect(w.calls).toContain("contact:new PO box");
  await alice.goto(at("/zh/privacy/"));
  await expect(alice.locator(".operator-contact")).toContainText("P.O. Box 77, Cupertino, CA 95015, USA");
  await expect(alice.locator(".operator-contact")).toContainText("电话: +1 408 555 0100");
});

test("feedback reaches the moderators, who file it; a player may allow a reply", async ({ context }) => {
  const { w, alice } = await twoPlayers(context, false);
  await alice.goto(at("/en/help/"));
  await alice.getByRole("link", { name: "Send feedback" }).click();
  await alice.getByRole("radio", { name: "Something doesn't work" }).check();
  await alice.getByLabel("Your message").fill("The clock froze after a reconnect");
  await alice.getByLabel("You may reply to my account email").check();
  await alice.getByRole("button", { name: "Send feedback" }).click();
  await expect(alice.getByText("Thank you! Your feedback has reached us.")).toBeVisible();
  expect(w.feedback[0]).toMatchObject({ kind: "problem", message: "The clock froze after a reconnect", page: `${at("/en/help/")}`, lang: "en", reply_to: "alice_xq@example.com" });

  w.moderator = true;
  await alice.goto(at("/en/moderate/?tab=feedback"));
  await expect(alice.getByRole("button", { name: "Open (1)" })).toHaveAttribute("aria-pressed", "true");
  await expect(alice.getByText("The clock froze after a reconnect")).toBeVisible();
  await expect(alice.getByRole("link", { name: "alice_xq@example.com" })).toHaveAttribute("href", "mailto:alice_xq@example.com");
  await alice.getByLabel("Status").selectOption("planned");
  await alice.getByLabel("Private note").fill("relay reconnect bug");
  await alice.getByRole("button", { name: "Save", exact: true }).click();
  await expect(alice.getByRole("button", { name: "Planned (1)" })).toBeVisible();
  expect(w.calls).toContain("feedback:1:planned:relay reconnect bug");
});

test("moderators read the daily summary, keep or undo automatic steps, and switch categories", async ({ context }) => {
  const { w, alice } = await twoPlayers(context, false);
  const step = (id: number, kind: string, category: string, verdict: string, target: string) => ({
    id, at: "2026-10-21T08:00:00Z", source: id === 1 ? "rules" : "ai:claude-code", kind, category, verdict, confidence: 0.9, reason: `reason ${id}`,
    details: kind === "hide-username" ? { old: "rude_name", new: "player-1234567" } : {}, review: null, reviewed_at: null, review_note: null, reviewed_by: null,
    target, report: id, report_note: "kept saying wow", reporter: "alice_xq", game: GAME,
  });
  w.steps = [step(1, "mute-chat", "chat", "valid", "bob_xq"), step(2, "hide-username", "username", "valid", "player-1234567")];
  w.switches = ["chat", "engine", "other", "stalling", "username"].map((category) => ({ category, on: category !== "stalling", pending: 0, reviewed: 3, undone: category === "stalling" ? 2 : 0 }));
  w.digest = { id: 1, at: new Date().toISOString(), source: "ai:claude-code", summary: "## Triage summary, 2026-10-21\n\n- **2 automatic steps** (mute-chat 1).\n\n### Feedback themes\n- Clock freezes (2) [14, 17]" };
  w.moderator = true;
  await alice.goto(at("/en/moderate/"));
  const digest = alice.locator(".digest");
  await expect(digest.getByRole("heading", { name: "Triage summary, 2026-10-21" })).toBeVisible();
  await expect(digest.locator("strong", { hasText: "2 automatic steps" })).toBeVisible();
  await expect(digest.getByRole("listitem").filter({ hasText: "Clock freezes (2) [14, 17]" })).toBeVisible();
  await expect(alice.getByText("Is the PC's timer running?")).toHaveCount(0);

  const steps = alice.locator(".auto-steps > li");
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(1)).toContainText("Hid the username (now player-1234567) · rude_name");
  await steps.nth(0).getByLabel("Note (optional, kept in the log)").fill("clear spam");
  await steps.nth(0).getByRole("button", { name: "Keep" }).click();
  await expect(steps).toHaveCount(1);
  await steps.nth(0).getByRole("button", { name: "Undo" }).click();
  await expect(alice.getByText("Nothing waiting.")).toBeVisible();
  expect(w.calls).toEqual(expect.arrayContaining(["review:1:kept:clear spam", "review:2:undone:null"]));
  await alice.getByRole("button", { name: "Reviewed" }).click();
  await expect(steps.first()).toContainText("Kept · alice_xq");

  await expect(alice.getByRole("button", { name: "Turn on Stalling" })).toBeDisabled();
  await alice.getByLabel("Reason for switching (kept in the log)").fill("rule fixed");
  await alice.getByRole("button", { name: "Turn on Stalling" }).click();
  await expect(alice.getByRole("button", { name: "Turn off Stalling" })).toBeVisible();
  expect(w.calls).toContain("auto:stalling:true:rule fixed");

  // An old summary says the assistant on the PC has stopped.
  w.digest = { ...w.digest, at: "2026-10-01T07:30:00Z" };
  await alice.reload();
  await expect(alice.getByText("Is the PC's timer running?")).toBeVisible();
});

test("a player whose chat is paused sees until when, and has no phrases to send", async ({ context }) => {
  const { w, alice, bob } = await twoPlayers(context, false);
  w.blackMutedUntil = new Date(Date.now() + 5 * 86_400_000).toISOString();
  await startGame(alice, bob);
  await expect(bob.getByText(/Your chat is paused until/)).toBeVisible();
  await expect(bob.getByRole("button", { name: "Good luck" })).toHaveCount(0);
  await expect(alice.getByRole("button", { name: "Good luck" })).toBeVisible();
});

test("coaching: a player under 16 asks a coach through their guardian; the coach accepts and sees their games, other children unnamed", async ({ context }) => {
  const { w, alice, bob } = await twoPlayers(context, false);
  const empty = { needs_guardian: false, coach_problem: null, as_student: [], visits: [], requests: [], students: [], codes: [] };
  w.coaching.bob_xq = { ...empty, needs_guardian: true, coach_problem: "age" };
  await bob.goto(at("/en/coach/"));
  await expect(bob.getByText("No coach linked.")).toBeVisible();
  await expect(bob.getByText("Coaches must be 18 or over.")).toBeVisible();
  await bob.getByLabel("Coach's username").fill("alice_xq");
  await bob.getByLabel("Your parent's or guardian's email (they confirm first)").fill("mum@example.com");
  w.requestAnswer = { hint: "guardian-self" };
  await bob.getByRole("button", { name: "Send request" }).click();
  await expect(bob.locator(".coach-page").getByRole("alert")).toHaveText("That's your own email. Enter your parent's or guardian's.");
  w.requestAnswer = { status: "guardian" };
  await bob.getByRole("button", { name: "Send request" }).click();
  await expect(bob.getByText("We've emailed your parent or guardian; alice_xq sees your request once they confirm.")).toBeVisible();
  expect(w.calls).toContain("request:alice_xq:null:false:mum@example.com");

  w.coaching.alice_xq = { ...empty, requests: [{ id: 7, student: "bob_xq", kind: "coach", status: "coach", under16: true, created_at: "2026-10-21T10:00:00Z" }] };
  await alice.goto(at("/en/coach/"));
  await expect(alice.getByText("under 16, guardian confirmed")).toBeVisible();
  w.coaching.alice_xq = { ...empty, students: [{ id: 7, student: "bob_xq", kind: "coach", since: "2026-10-21T10:00:00Z", ratings: { blitz: 1158 }, games_30d: 1 }] };
  await alice.getByRole("button", { name: "Accept" }).click();
  expect(w.calls).toContain("answer:7:true");
  await expect(alice.getByRole("cell", { name: "Blitz 1158" })).toBeVisible();
  await alice.getByRole("button", { name: "Games", exact: true }).click();
  await expect(alice.getByText("an opponent under 16")).toBeVisible();
  await expect(alice.getByRole("link", { name: "Open", exact: true })).toHaveAttribute("href", new RegExp(`/en/game/\\?id=${GAME}&coach=1$`));
  await alice.getByRole("button", { name: "New code" }).click();
  expect(w.calls).toContain("code");

  await alice.goto(at(`/en/game/?id=${GAME}&coach=1`));
  await expect(alice.getByText("An opponent under 16")).toBeVisible();
  await expect(alice.getByRole("link", { name: "bob_xq" })).toBeVisible();
  expect(w.calls).toContain(`coach-open:${GAME}`);
});

test("the Support page shows the donation links the moderators set", async ({ context }) => {
  const { w, alice } = await twoPlayers(context, false);
  await alice.goto(at("/en/support/"));
  await expect(alice.getByText("Ways to give are coming soon.")).toBeVisible();
  w.moderator = true;
  await alice.goto(at("/en/moderate/?tab=settings"));
  await alice.getByLabel("Stripe Payment Link").fill("https://buy.stripe.com/test_00g5kE");
  await alice.getByLabel("Reason (kept in the log)").first().fill("Stripe ready");
  await alice.getByRole("button", { name: "Save links" }).click();
  await expect(alice.getByText("Saved: the Support page shows it now.")).toBeVisible();
  expect(w.calls).toContain("donations:Stripe ready");
  await alice.goto(at("/zh/support/"));
  await expect(alice.getByRole("link", { name: "捐助（银行卡、支付宝、微信支付）" })).toHaveAttribute("href", "https://buy.stripe.com/test_00g5kE");
  await expect(alice.getByRole("link", { name: "在 GitHub Sponsors 上赞助" })).toHaveCount(0);
});

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
    // Both end reports carry the chat as each browser saw it.
    for (const by of ["red", "black"] as const) {
      const end = w.reports.filter((r) => r.by === by && r.report.kind === "end").at(-1)!.report as { chat?: { by: string; phrase: string }[] };
      expect(end.chat).toEqual([expect.objectContaining({ by: "black", phrase: "luck" })]);
    }

    // The winner reports the opponent's play.
    await bob.getByRole("button", { name: "Report" }).click();
    await bob.getByLabel("Engine or outside help").check();
    await bob.getByLabel("Anything we should know (optional)").fill("instant moves");
    await bob.getByRole("button", { name: "Send report" }).click();
    await expect(bob.getByText("Thank you. Every report is reviewed; you'll be told if action is taken.")).toBeVisible();
    expect(w.calls).toContain("report:engine:instant moves");

    // As served by Pages the engine needs the service worker, which these tests turn off: the
    // review says so, and nothing is sent.
    if (process.env.E2E_PAGES) {
      for (const p of [alice, bob]) await expect(p.getByText("Game Review needs a browser that can run the engine.")).toBeVisible();
      expect(w.analyses).toEqual([]);
      return;
    }
    // Game Review in both browsers; each sends the same fair-play analysis of the rated game.
    for (const p of [alice, bob]) await expect(p.getByRole("region", { name: "Game Review" })).toContainText(/Accuracy: \d+ you/, { timeout: 30_000 });
    // The evaluation graph, from each player's side.
    for (const p of [alice, bob]) await expect(p.getByRole("img", { name: "Your winning chances over the game" })).toBeVisible();
    // …and the opponent's moves on request.
    await bob.getByRole("radio", { name: "Opponent" }).click();
    await expect(bob.getByRole("img", { name: "Your opponent's winning chances over the game" })).toBeVisible();
    await expect(bob.getByRole("link", { name: "Analyse" })).toHaveAttribute("href", /side=black/);
    await expect.poll(() => w.analyses.length, { timeout: 15_000 }).toBe(2);
    const [a, b] = w.analyses;
    expect(a!.analysis).toMatchObject({ v: 1, depth: 8 });
    expect(a!.analysis.positions).toHaveLength(moves.length + 1);
    expect(b!.analysis).toEqual(a!.analysis);
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
