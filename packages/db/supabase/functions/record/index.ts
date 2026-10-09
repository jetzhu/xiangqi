// The `record` server function (Supabase Edge Function): see packages/records/src/server.
// scripts/functions.mjs bundles this file and everything it imports into one script, then
// deploys it. Supabase provides SUPABASE_URL and the service key to the function.
import { BOTS, loadPuzzles } from "@xq/content";
import { handle, restBackend } from "../../../../records/src/server/record.js";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): void;
};

/** The service key: the legacy one, or the newer secret key (SUPABASE_SECRET_KEYS, a JSON map). */
function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
  const key = keys.default ?? Object.values(keys)[0];
  if (!key) throw new Error("no service key in the function's environment");
  return key;
}

const backend = restBackend(Deno.env.get("SUPABASE_URL")!, serviceKey());
const content = loadPuzzles().then((puzzles) => ({ bots: BOTS, puzzles }));

Deno.serve(async (req) => {
  try {
    return await handle(req, backend, await content);
  } catch (e) {
    // The site retries a failure like this one later.
    console.error(e);
    return new Response(JSON.stringify({ error: "server error" }), {
      status: 500,
      headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
    });
  }
});
