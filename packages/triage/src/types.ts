// What an adviser sees and says (docs/v0.3-online-design.md, "Moderation", triage phase 3; since
// phase 2, docs/v0.4-design.md, a confident verdict may take a private, reversible step).
// A case is exactly what the database's triage_pending gives: the report, the game, the
// suspect's chat and standing, and the rules' verdict. No email addresses, nothing else.

export type Verdict = "valid" | "invalid" | "inconclusive";
export type ChatEntry = { ply: number; by: "red" | "black"; phrase: string };

export interface TriageCase {
  report: number;
  reason: "engine" | "stalling" | "chat" | "username" | "other";
  note: string | null;
  reported_at: string;
  suspect: string;
  game: {
    speed: string;
    base: number;
    inc: number;
    result: string | null;
    reason: string | null;
    plies: number;
    suspect_color: "red" | "black";
    labels: string[];
    chat: { red: ChatEntry[] | null; black: ChatEntry[] | null };
  };
  standing: { games: number; score: number; verdict: string } | null;
  rules: { verdict: Verdict; confidence: number; rule: string; reason: string } | null;
}

/**
 * An adviser's verdict on one report. A confident one (0.8 or more) that the rules don't
 * contradict may close the report, pause chat or hide a username; a moderator reviews it later.
 */
export interface Advice {
  verdict: Verdict;
  /** 0 to 1. */
  confidence: number;
  /** One or two sentences a moderator can check against the case. */
  reason: string;
}

/** Anything that can judge a case: an AI behind a CLI or an API, or a test double. */
export interface Adviser {
  /** Short, stored with each verdict as "ai:<name>" (e.g. "claude-code"). */
  readonly name: string;
  /** The model, if known, stored with the verdict so decisions can be traced. */
  readonly model?: string | undefined;
  advise(c: TriageCase): Promise<Advice>;
  /** Free text for a system prompt and a message (the daily summary); absent for advisers that only judge. */
  complete?(system: string, user: string, maxTokens?: number): Promise<string>;
}

/** What the daily summary covers (the database's triage_digest_input). */
export interface DigestInput {
  since: string;
  steps: { kind: string; source: string; category: string; n: number }[];
  waiting_review: number;
  oldest_waiting: string | null;
  open_reports: number;
  players_with_open_reports: number;
  reports_made: number;
  reports_per_day_30d: number;
  switched_off: { category: string; note: string }[];
  switches: Record<string, number>;
  feedback: { id: number; kind: string; lang: string | null; page: string | null; message: string }[];
  feedback_open: number;
}
