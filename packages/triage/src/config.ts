// Which adviser to use, from a JSON file (triage.config.example.json shows every option).
// Secrets never go in the file: it names the environment variable that holds each key.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Exec, anthropic, claudeCode, command, exec, noAdviser, openaiCompatible } from "./advisers.js";
import type { Adviser } from "./types.js";

export interface TriageConfig {
  adviser: "claude-code" | "anthropic" | "openai-compatible" | "command" | "none";
  /** Reports per run. */
  limit?: number;
  "claude-code"?: { command?: string; model?: string; timeoutMs?: number };
  anthropic?: { model: string; apiKeyEnv?: string; baseUrl?: string };
  "openai-compatible"?: { baseUrl: string; model: string; apiKeyEnv?: string };
  command?: { command: string; args?: string[]; timeoutMs?: number };
}

/** TRIAGE_CONFIG, else ~/.config/xiangqi-triage.json; with no file, Claude Code with its defaults. */
export function loadConfig(env: Record<string, string | undefined> = process.env): TriageConfig {
  const path = env.TRIAGE_CONFIG ?? join(homedir(), ".config", "xiangqi-triage.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TriageConfig;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" && !env.TRIAGE_CONFIG) return { adviser: "claude-code" };
    throw new Error(`can't read the triage config ${path}: ${(e as Error).message}`);
  }
}

const key = (env: Record<string, string | undefined>, name: string | undefined, fallback: string) => {
  const v = env[name ?? fallback];
  if (!v) throw new Error(`set ${name ?? fallback} to the API key`);
  return v;
};

/** The adviser the config names. */
export function adviserFrom(c: TriageConfig, env: Record<string, string | undefined> = process.env, deps: { exec?: Exec; fetch?: typeof fetch } = {}): Adviser {
  const run = deps.exec ?? exec;
  const f = deps.fetch ?? fetch;
  switch (c.adviser) {
    case "claude-code":
      return claudeCode(c["claude-code"] ?? {}, run);
    case "anthropic": {
      const o = c.anthropic;
      if (!o?.model) throw new Error('"anthropic" needs a model');
      return anthropic({ apiKey: key(env, o.apiKeyEnv, "ANTHROPIC_API_KEY"), model: o.model, ...(o.baseUrl ? { baseUrl: o.baseUrl } : {}) }, f);
    }
    case "openai-compatible": {
      const o = c["openai-compatible"];
      if (!o?.baseUrl || !o.model) throw new Error('"openai-compatible" needs baseUrl and model');
      // A local server (Ollama, LM Studio) may need no key.
      return openaiCompatible({ baseUrl: o.baseUrl, model: o.model, apiKey: o.apiKeyEnv ? key(env, o.apiKeyEnv, o.apiKeyEnv) : undefined }, f);
    }
    case "command":
      if (!c.command?.command) throw new Error('"command" needs a command');
      return command(c.command, run);
    case "none":
      return noAdviser();
    default:
      throw new Error(`unknown adviser "${String((c as { adviser: unknown }).adviser)}"`);
  }
}
