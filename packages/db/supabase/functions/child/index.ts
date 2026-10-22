// The `child` server function (Supabase Edge Function): see handler.ts. scripts/functions.mjs
// bundles it and deploys it. Supabase provides the project's address and keys.
import { handle } from "./handler.js";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): void;
};

const keys = (name: string) => JSON.parse(Deno.env.get(name) ?? "{}") as Record<string, string>;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? keys("SUPABASE_SECRET_KEYS").default ?? Object.values(keys("SUPABASE_SECRET_KEYS"))[0] ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? keys("SUPABASE_PUBLISHABLE_KEYS").default ?? Object.values(keys("SUPABASE_PUBLISHABLE_KEYS"))[0] ?? "";

Deno.serve((req) => handle(req, { url: Deno.env.get("SUPABASE_URL")!, anonKey, serviceKey }));
