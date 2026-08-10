/**
 * Playwright config — ui-next setup + login against a real Console kernel.
 *
 * Trace / screenshot / video always on so `bunx playwright show-report`
 * opens a full HTML timeline of what the automated browser did.
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/console",
  testMatch: "setup-ui-next.spec.ts",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/ui-next" }]],
  use: {
    baseURL: "http://127.0.0.1:6538",
    headless: true,
    trace: "on",
    screenshot: "on",
    video: "on",
  },
  webServer: {
    command: "bun run build:console-next && bun ./tests/console/serve-fixture-ui-next.ts",
    url: "http://127.0.0.1:6538/console/setup/status",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
