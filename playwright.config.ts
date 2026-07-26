/**
 * Playwright config — Console smoke on :6533.
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/console",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:6533",
    headless: true,
    trace: "off",
  },
  webServer: {
    command:
      "bun run build && bun ./tests/console/serve-fixture.ts",
    url: "http://127.0.0.1:6533/console/setup/status",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
