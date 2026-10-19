import { describe, expect, it } from "vitest";
import { type Exec, anthropic, claudeCode, openaiCompatible } from "../src/advisers.js";
import { adviserFrom } from "../src/config.js";
import { SYSTEM, parseAdvice } from "../src/prompt.js";
import { runTriage } from "../src/run.js";
import { type Store, managementStore, sqlText } from "../src/store.js";
import type { Adviser, TriageCase } from "../src/types.js";

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

describe("a triage run", () => {
  function store(cases: TriageCase[]) {
    const saved: unknown[][] = [];
    const s: Store = { pending: async () => cases, save: async (...a) => void saved.push(a) };
    return { s, saved };
  }

  it("stores each verdict under the adviser's name, skips bad answers, and saves nothing in a dry run", async () => {
    const answers = [ANSWER, "no idea"];
    const adviser: Adviser = { name: "test", model: "m1", advise: async () => parseAdvice(answers.shift()!) };
    const { s, saved } = store([CASE, { ...CASE, report: 8 }]);
    const r = await runTriage({ adviser, store: s });
    expect(r).toMatchObject({ advised: 1, failed: [{ report: 8 }] });
    expect(saved).toEqual([[7, "ai:test", { verdict: "valid", confidence: 0.8, reason: "Three wows after blunders." }, "m1"]]);
    const dry = store([CASE]);
    await runTriage({ adviser: { name: "test", advise: async () => parseAdvice(ANSWER) }, store: dry.s, dryRun: true });
    expect(dry.saved).toEqual([]);
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
