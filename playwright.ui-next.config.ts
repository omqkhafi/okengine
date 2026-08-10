/**
 * Playwright config — ui-next setup claim against a real Console kernel.
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/console",
  testMatch: "setup-ui-next.spec.ts",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:6533",
    headless: true,
    trace: "off",
  },
  webServer: {
    command: "bun run build:console-next && bun ./tests/console/serve-fixture-ui-next.ts",
    url: "http://127.0.0.1:6533/console/setup/status",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
