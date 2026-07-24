/**
 * Playwright webServer entry — Console kernel on 6533 with a known claim code.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveConsole } from "../../src/console/server/serve.ts";

const cwd = await mkdtemp(join(tmpdir(), "oke-console-smoke-"));
const claimPath = join(dirname(fileURLToPath(import.meta.url)), ".claim-code");

const server = await serveConsole({
  port: 6533,
  hostname: "127.0.0.1",
  cwd,
  secret: "playwright-console-secret",
  silentClaim: true,
  env: "dev",
});

const claimCode = server.console.state.claim.code;
await Bun.write(claimPath, claimCode);
console.log(`console smoke fixture ready on ${server.url}`);

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
