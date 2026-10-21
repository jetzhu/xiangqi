// The providers. Each turns the shared prompt into an answer; pick one in the config file.
//   claude-code        the Claude Code CLI ("claude -p"), using the operator's own subscription
//   anthropic          the Anthropic Messages API, with an API key
//   openai-compatible  any /chat/completions API: OpenAI, OpenRouter, Ollama, LM Studio, vLLM…
//   command            any program that reads the prompt on stdin and prints the answer
import { spawn } from "node:child_process";
import { SYSTEM, casePrompt, parseAdvice } from "./prompt.js";
import type { Adviser, TriageCase } from "./types.js";

/** Runs a program with `input` on stdin and returns stdout (injectable for tests). */
export type Exec = (command: string, args: string[], input: string, timeoutMs: number) => Promise<string>;

export const exec: Exec = (command, args, input, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${command} exited ${code}: ${err.slice(0, 300)}`));
    });
    child.stdin.end(input);
  });

/**
 * Claude Code in print mode, on the operator's own subscription: the case on stdin, the answer
 * as JSON ({"result": "..."}). Its own system prompt is replaced with ours and every tool is
 * off, so it can only read the case and answer.
 */
export function claudeCode(o: { command?: string; model?: string; timeoutMs?: number } = {}, run: Exec = exec): Adviser {
  const complete = async (system: string, user: string) => {
    const args = ["-p", "--output-format", "json", "--system-prompt", system, "--tools", "", ...(o.model ? ["--model", o.model] : [])];
    const out = await run(o.command ?? "claude", args, user, o.timeoutMs ?? 120_000);
    try {
      return String((JSON.parse(out) as { result?: unknown }).result ?? out);
    } catch {
      // Plain text output: read it as it is.
      return out;
    }
  };
  return { name: "claude-code", model: o.model, complete, advise: async (c) => parseAdvice(await complete(SYSTEM, casePrompt(c))) };
}

/** Any program: the system prompt and the case on stdin, the answer on stdout. */
export function command(o: { command: string; args?: string[]; timeoutMs?: number }, run: Exec = exec): Adviser {
  const complete = (system: string, user: string) => run(o.command, o.args ?? [], `${system}\n\n${user}`, o.timeoutMs ?? 120_000);
  return { name: `command:${o.command.split("/").pop()}`, complete, advise: async (c) => parseAdvice(await complete(SYSTEM, casePrompt(c))) };
}

async function postJson(fetchFn: typeof fetch, url: string, headers: Record<string, string>, body: object): Promise<unknown> {
  const res = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url}: ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** The Anthropic Messages API. */
export function anthropic(o: { apiKey: string; model: string; baseUrl?: string; maxTokens?: number }, fetchFn: typeof fetch = fetch): Adviser {
  const complete = async (system: string, user: string, maxTokens?: number) => {
    const data = (await postJson(
      fetchFn,
      `${o.baseUrl ?? "https://api.anthropic.com"}/v1/messages`,
      { "x-api-key": o.apiKey, "anthropic-version": "2023-06-01" },
      { model: o.model, max_tokens: maxTokens ?? o.maxTokens ?? 400, system, messages: [{ role: "user", content: user }] },
    )) as { content?: { type: string; text?: string }[] };
    return (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  };
  return { name: "anthropic", model: o.model, complete, advise: async (c) => parseAdvice(await complete(SYSTEM, casePrompt(c))) };
}

/** Any OpenAI-compatible chat completions API (a key is optional, for local servers). */
export function openaiCompatible(o: { baseUrl: string; model: string; apiKey?: string | undefined }, fetchFn: typeof fetch = fetch): Adviser {
  const complete = async (system: string, user: string) => {
    const data = (await postJson(fetchFn, `${o.baseUrl.replace(/\/$/, "")}/chat/completions`, o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {}, {
      model: o.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
    })) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  };
  return { name: "openai-compatible", model: o.model, complete, advise: async (c) => parseAdvice(await complete(SYSTEM, casePrompt(c))) };
}

/** A fixed answer, for trying the pipeline without any AI ("adviser": "none" in the config). */
export const noAdviser = (): Adviser => ({
  name: "none",
  advise: async (c: TriageCase) => ({ verdict: "inconclusive", confidence: 0, reason: `No adviser configured (report ${c.report}).` }),
});
