import { defineConfig } from "@playwright/test";

// End-to-end tests run against the static export (pnpm build first), served with the
// production headers. They use the system Chrome, so no browser download is needed.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4100", channel: "chrome", locale: "en-US" },
  webServer: { command: "node scripts/serve.mjs", env: { PORT: "4100" }, url: "http://127.0.0.1:4100/en/", reuseExistingServer: false },
});
