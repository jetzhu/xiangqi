import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { at } from "./helpers.js";

// The Pages build gets COOP/COEP from a service worker (coi-serviceworker, patched in
// scripts/copy-engine.mjs). Calls to other sites, like Supabase, must still work through it,
// including empty "204 No Content" replies, which Supabase sends after an update.
test.skip(!process.env.E2E_PAGES, "the service worker only runs in the GitHub Pages build");

let server: Server;
let api = "";
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "*", "access-control-allow-headers": "*" };
    if (req.method === "OPTIONS") return res.writeHead(200, cors).end();
    req.resume();
    req.on("end", () => (req.url === "/empty" ? res.writeHead(204, cors).end() : res.writeHead(200, { ...cors, "content-type": "application/json" }).end("[]")));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

test("calls to other sites work through the service worker, empty replies included", async ({ page }) => {
  await page.goto(at("/en/help/"));
  await page.waitForFunction(() => window.crossOriginIsolated && !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  const results = await page.evaluate(async (base) => {
    const call = async (method: string, path: string) => {
      try {
        const res = await fetch(`${base}${path}`, { method, ...(method === "GET" ? {} : { body: "{}", headers: { "content-type": "application/json" } }) });
        return res.status;
      } catch (e) {
        return String(e);
      }
    };
    return [await call("GET", "/data"), await call("PATCH", "/empty"), await call("POST", "/empty"), await call("DELETE", "/empty")];
  }, api);
  expect(results).toEqual([200, 204, 204, 204]);
});
