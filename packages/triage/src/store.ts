// Where the cases come from and the verdicts go: the database functions triage_pending and
// save_triage_advice (migration 20261019180000_triage.sql). The runner reaches them through the
// Supabase Management API with a personal access token, as the deploy scripts do.
import type { Advice, TriageCase } from "./types.js";

export interface Store {
  pending(source: string, limit: number): Promise<TriageCase[]>;
  save(report: number, source: string, advice: Advice, model: string): Promise<void>;
}

/** Text into SQL safely: sent base64-encoded and decoded by Postgres, so no quoting can break out. */
export const sqlText = (s: string) => `convert_from(decode('${Buffer.from(s, "utf8").toString("base64")}', 'base64'), 'utf8')`;

export function managementStore(o: { token: string; ref: string }, fetchFn: typeof fetch = fetch): Store {
  const sql = async (query: string): Promise<unknown[]> => {
    const res = await fetchFn(`https://api.supabase.com/v1/projects/${o.ref}/database/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${o.token}`, "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`database query: ${res.status} ${text.slice(0, 300)}`);
    return text ? (JSON.parse(text) as unknown[]) : [];
  };
  return {
    async pending(source, limit) {
      const rows = (await sql(`select public.triage_pending(${sqlText(source)}, ${Math.floor(limit)}) as cases`)) as { cases: TriageCase[] }[];
      return rows[0]?.cases ?? [];
    },
    async save(report, source, advice, model) {
      await sql(
        `select public.save_triage_advice(${Math.floor(report)}, ${sqlText(source)}, ${sqlText(advice.verdict)}, ${Number(advice.confidence)}, ${sqlText(model)}, ${sqlText(advice.reason)})`,
      );
    },
  };
}
