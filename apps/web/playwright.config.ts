import { defineConfig } from "@playwright/test";
import { BASE } from "./e2e/helpers.js";

// End-to-end tests run against the static export (pnpm build first), served with the
// production headers. They use the system Chrome, so no browser download is needed.
// E2E_PAGES=1 tests a GitHub Pages build instead: served under its base path with no COOP/COEP
// headers, so the engine depends on the service worker (build with the Pages variables first).
const pages = !!process.env.E2E_PAGES;
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4100", channel: "chrome", locale: "en-US" },
  webServer: {
    command: "node scripts/serve.mjs",
    env: pages ? { PORT: "4100", BASE_PATH: BASE, NO_HEADERS: "1" } : { PORT: "4100" },
    url: `http://127.0.0.1:4100${BASE}/en/`,
    reuseExistingServer: false,
  },
});
