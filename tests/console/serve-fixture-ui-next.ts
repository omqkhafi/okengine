/**
 * Playwright webServer — Console kernel on 6538 serving ui-next/dist.
 *
 * Seeds a real Manifest (FLOWS_TEST_MANIFEST) and one WideEvent so the Flows
 * page can assert graph nodes + Traces without inventing client-side mocks.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveConsole } from "../../src/console/server/serve.ts";
import { FLOWS_TEST_MANIFEST } from "../../src/console/ui/flows/fixture.ts";
import type { WideEvent } from "../../src/runs/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const uiNextDist = join(here, "../../src/console/ui-next/dist/");
const cwd = await mkdtemp(join(tmpdir(), "oke-console-ui-next-"));
const claimPath = join(here, ".claim-code-ui-next");

const server = await serveConsole({
  port: 6538,
  hostname: "127.0.0.1",
  cwd,
  secret: "playwright-console-ui-next-secret",
  silentClaim: true,
  // Match kernel unit tests: test drivers (memory) so local .env redis URLs
  // do not hard-fail the Playwright webServer boot.
  env: "test",
  staticDir: uiNextDist,
  manifest: FLOWS_TEST_MANIFEST,
});

const now = Date.now();
const seedRun: WideEvent = {
  id: "pw-run-bookings-create",
  flow: "bookings.create",
  unit: "bookings",
  trigger: "http",
  plane: "user",
  gates: [],
  cache: "none",
  effects: [],
  logs: [],
  durationMs: 12,
  startedAt: now - 12,
  endedAt: now,
  dimensions: { flow: "bookings.create" },
};

const runs = server.console.app.bootResult?.runs;
if (!runs) {
  throw new Error("ui-next fixture: Console bootResult.runs missing");
}
await runs.append(seedRun);

const claimCode = server.console.state.claim.code;
await Bun.write(claimPath, claimCode);
console.log(`console ui-next setup fixture ready on ${server.url}`);

const stop = () => {
  server.stop(true);
  try {
    Bun.spawnSync(["rm", "-f", claimPath]);
  } catch {
    // ignore
  }
};

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
