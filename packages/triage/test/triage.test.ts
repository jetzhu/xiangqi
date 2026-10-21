import { describe, expect, it } from "vitest";
import { type Exec, anthropic, claudeCode, openaiCompatible } from "../src/advisers.js";
import { adviserFrom } from "../src/config.js";
import { SYSTEM, parseAdvice } from "../src/prompt.js";
import { runDigest, runTriage } from "../src/run.js";
import { DIGEST_SYSTEM, digestFigures } from "../src/digest.js";
import { type Store, managementStore, sqlText } from "../src/store.js";
import type { Adviser, DigestInput, TriageCase } from "../src/types.js";

const CASE: TriageCase = {
  report: 7,
  reason: "chat",
  note: "kept saying wow",
  reported_at: "2026-10-18T10:00:00Z",
  suspect: "bob_xq",
  game: { speed: "blitz", base: 300, inc: 3, result: "black", reason: "resign", plies: 40, suspect_color: "black", labels: [], chat: { red: null, black: null } },
  standing: null,
  rules: { verdict: "inconclusive", confidence: 0.5, rule: "chat-borderline", reason: "Sent 3 phrases." },
};
const ANSWER = '{"verdict": "valid", "confidence": 0.8, "reason": "Three wows after blunders."}';

/** A fetch that records each request and answers with `body`. */
function fakeFetch(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("reading an adviser's answer", () => {
  it("takes the JSON object out of the text, checks it and clamps the confidence", () => {
    expect(parseAdvice(`Here you go:\n${ANSWER}\nThanks`)).toEqual({ verdict: "valid", confidence: 0.8, reason: "Three wows after blunders." });
    expect(parseAdvice('{"verdict": "invalid", "confidence": 3, "reason": " ok "}')).toEqual({ verdict: "invalid", confidence: 1, reason: "ok" });
    expect(() => parseAdvice("I think it's valid")).toThrow(/no JSON/);
    expect(() => parseAdvice('{"verdict": "guilty", "confidence": 1, "reason": "x"}')).toThrow(/verdict/);
    expect(() => parseAdvice('{"verdict": "valid", "confidence": 1}')).toThrow(/reason/);
  });
});

describe("the providers", () => {
  it("runs Claude Code in print mode with our prompt and no tools", async () => {
    let seen: { command: string; args: string[]; input: string } | null = null;
    const exec: Exec = async (command, args, input) => {
      seen = { command, args, input };
      return JSON.stringify({ type: "result", result: ANSWER });
    };
    const a = claudeCode({ model: "sonnet" }, exec);
    expect(await a.advise(CASE)).toMatchObject({ verdict: "valid" });
    expect(seen!.command).toBe("claude");
    expect(seen!.args).toEqual(["-p", "--output-format", "json", "--system-prompt", SYSTEM, "--tools", "", "--model", "sonnet"]);
    expect(seen!.input).toContain('"suspect": "bob_xq"');
  });

  it("calls the Anthropic API and any OpenAI-compatible API", async () => {
    const an = fakeFetch({ content: [{ type: "text", text: ANSWER }] });
    expect(await anthropic({ apiKey: "k1", model: "claude-sonnet-5-5" }, an.f).advise(CASE)).toMatchObject({ verdict: "valid" });
    expect(an.calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(an.calls[0]!.init.headers).toMatchObject({ "x-api-key": "k1" });
    expect(JSON.parse(String(an.calls[0]!.init.body))).toMatchObject({ model: "claude-sonnet-5-5", system: SYSTEM });

    const oa = fakeFetch({ choices: [{ message: { content: ANSWER } }] });
    expect(await openaiCompatible({ baseUrl: "http://localhost:11434/v1/", model: "llama3" }, oa.f).advise(CASE)).toMatchObject({ verdict: "valid" });
    expect(oa.calls[0]!.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(oa.calls[0]!.init.headers).not.toHaveProperty("authorization");
  });

  it("chooses the provider from the config, with keys from the environment only", () => {
    expect(adviserFrom({ adviser: "claude-code" }).name).toBe("claude-code");
    expect(adviserFrom({ adviser: "none" }).name).toBe("none");
    expect(() => adviserFrom({ adviser: "anthropic", anthropic: { model: "m" } }, {})).toThrow(/ANTHROPIC_API_KEY/);
    expect(adviserFrom({ adviser: "anthropic", anthropic: { model: "m", apiKeyEnv: "MY_KEY" } }, { MY_KEY: "k" }).model).toBe("m");
    expect(adviserFrom({ adviser: "openai-compatible", "openai-compatible": { baseUrl: "http://x/v1", model: "m" } }, {}).name).toBe("openai-compatible");
    expect(() => adviserFrom({ adviser: "magic" } as never)).toThrow(/unknown adviser/);
  });
});

/** A store that records what's saved; `step` is what saving a verdict returns. */
function store(cases: TriageCase[], step: number | null = null) {
  const saved: unknown[][] = [];
  const s: Store = {
    pending: async () => cases,
    save: async (...a) => (saved.push(a), step),
    digestInput: async () => DIGEST,
    saveDigest: async (...a) => void saved.push(a),
  };
  return { s, saved };
}

describe("a triage run", () => {

  it("stores each verdict under the adviser's name, skips bad answers, and saves nothing in a dry run", async () => {
    const answers = [ANSWER, "no idea"];
    const adviser: Adviser = { name: "test", model: "m1", advise: async () => parseAdvice(answers.shift()!) };
    const { s, saved } = store([CASE, { ...CASE, report: 8 }]);
    const r = await runTriage({ adviser, store: s });
    expect(r).toMatchObject({ advised: 1, steps: 0, failed: [{ report: 8 }] });
    expect(saved).toEqual([[7, "ai:test", { verdict: "valid", confidence: 0.8, reason: "Three wows after blunders." }, "m1"]]);
    const dry = store([CASE]);
    await runTriage({ adviser: { name: "test", advise: async () => parseAdvice(ANSWER) }, store: dry.s, dryRun: true });
    expect(dry.saved).toEqual([]);
  });

  it("counts the automatic steps the verdicts took", async () => {
    const lines: string[] = [];
    const { s } = store([CASE], 41);
    const r = await runTriage({ adviser: { name: "test", advise: async () => parseAdvice(ANSWER) }, store: s, log: (l) => lines.push(l) });
    expect(r.steps).toBe(1);
    expect(lines).toContain("  took step #41");
  });

  it("sends an adviser's text to the database without letting it break out of the query", async () => {
    const evil = "x'); drop table public.reports; --";
    expect(sqlText(evil)).not.toContain("drop table");
    const { f, calls } = fakeFetch([]);
    await managementStore({ token: "t", ref: "abc" }, f).save(7, "ai:test", { verdict: "valid", confidence: 0.8, reason: evil }, "m1");
    const query = (JSON.parse(String(calls[0]!.init.body)) as { query: string }).query;
    expect(calls[0]!.url).toBe("https://api.supabase.com/v1/projects/abc/database/query");
    expect(query).toMatch(/^select public\.save_triage_advice\(7, convert_from/);
    expect(query).not.toContain("drop table");
  });
});

const DIGEST: DigestInput = {
  since: "2026-10-20T07:00:00Z",
  steps: [
    { kind: "close-report", source: "rules", category: "stalling", n: 3 },
    { kind: "mute-chat", source: "ai:claude-code", category: "chat", n: 1 },
  ],
  waiting_review: 4,
  oldest_waiting: "2026-10-19T10:00:00Z",
  open_reports: 2,
  players_with_open_reports: 1,
  reports_made: 5,
  reports_per_day_30d: 1.5,
  switched_off: [{ category: "stalling", note: "2 of the last 3 reviewed steps were undone" }],
  switches: { auto_chat: 1, auto_engine: 1, auto_other: 1, auto_stalling: 0, auto_username: 1 },
  feedback: [{ id: 14, kind: "problem", lang: "zh", page: "/zh/game/", message: "断线重连后时钟不动了" }],
  feedback_open: 3,
};

describe("the daily summary", () => {
  it("states the figures as they are", () => {
    const md = digestFigures(DIGEST, new Date("2026-10-21T07:00:00Z"));
    expect(md).toContain("## Triage summary, 2026-10-21");
    expect(md).toContain("**4 automatic steps** (close-report 3, mute-chat 1; by rules 3, ai:claude-code 1)");
    expect(md).toContain("**4 steps waiting for your look**, the oldest from 2026-10-19");
    expect(md).toContain("**Switched itself off:** stalling");
    expect(md).toContain("Automatic steps off for: stalling");
  });

  it("adds the adviser's themes and saves the summary; a failing adviser leaves the figures", async () => {
    let seen: { system: string; user: string } | null = null;
    const adviser: Adviser = {
      name: "test",
      advise: async () => parseAdvice(ANSWER),
      complete: async (system, user) => ((seen = { system, user }), "### Feedback themes\n- The clock stops after a reconnect (1) [14]"),
    };
    const { s, saved } = store([]);
    const md = await runDigest({ adviser, store: s });
    expect(seen!.system).toBe(DIGEST_SYSTEM);
    expect(seen!.user).toContain("断线重连");
    expect(md).toMatch(/Triage summary[\s\S]*### Feedback themes/);
    expect(saved[0]).toEqual(["ai:test", md, expect.objectContaining({ waiting_review: 4, feedback_new: 1 })]);
    expect(JSON.stringify(saved[0]![2])).not.toContain("断线");
    const broken = await runDigest({ adviser: { ...adviser, complete: async () => Promise.reject(new Error("offline")) }, store: s, dryRun: true });
    expect(broken).toContain("couldn't add notes");
  });
});
