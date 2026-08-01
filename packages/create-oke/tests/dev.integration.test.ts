/**
 * Gate: a create-oke-scaffolded standard project boots under default `oke dev`
 * (Prompt 24 harness: `keepAlive: false`, ephemeral `port: 0`, clean stop)
 * and serves one real flow request — then shuts down with no lingering port.
 *
 * Uses the real CLI `startApp` (boot → serve). No injection.
 * Opt-in via `CREATE_OKE_DEV_INTEGRATION=1` (separate from scaffold's
 * `CREATE_OKE_INTEGRATION` so default CI only pays for one install).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDev, type DevSession } from "../../../src/cli/dev.ts";
import { scaffold } from "../src/scaffold.ts";

const ENABLED = process.env["CREATE_OKE_DEV_INTEGRATION"] === "1";
const SECRET = "oke-create-oke-dev-integration-secret";
const TIMEOUT_MS = 180_000;

if (!ENABLED) {
  console.log("skip: create-oke oke dev boot (CREATE_OKE_DEV_INTEGRATION≠1)");
}

describe.skipIf(!ENABLED)("create-oke oke dev boot (Prompt 24 harness)", () => {
  let session: DevSession | undefined;
  let root: string | undefined;

  afterEach(async () => {
    const live = session;
    session = undefined;
    live?.stop();
    // App child + watcher must release cwd before rmSync (default hook
    // timeout is short; wait, then retry deletes).
    if (root) {
      const doomed = root;
      root = undefined;
      for (let attempt = 0; attempt < 25; attempt++) {
        try {
          rmSync(doomed, { recursive: true, force: true });
          return;
        } catch {
          await Bun.sleep(100);
        }
      }
      rmSync(doomed, { recursive: true, force: true });
    }
  }, 30_000);

  test(
    "scaffolded standard · bun install · oke dev · flow request · clean stop",
    async () => {
      root = mkdtempSync(join(tmpdir(), "create-oke-dev-"));
      const targetDir = join(root, "standard-app");
      scaffold({
        targetDir,
        name: "standard-app",
        source: { kind: "template", id: "standard" },
      });

      const install = Bun.spawn(["bun", "install"], {
        cwd: targetDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const installCode = await install.exited;
      if (installCode !== 0) {
        const err = await new Response(install.stderr).text();
        throw new Error(`bun install failed: ${err}`);
      }

      const result = await runDev({
        stdinIsTTY: false,
        cwd: targetDir,
        secret: SECRET,
        silentClaim: true,
        keepAlive: false,
        consolePort: 0,
        mcpPort: 0,
        appPort: 0,
        regenClient: async () => {},
        write: () => {},
      });

      expect(result.code).toBe(0);
      session = result.session;
      expect(session).toBeDefined();
      if (!session) return;

      expect(session.mcpUrl).toBeTruthy();
      expect(session.appPort).toBeGreaterThan(0);
      expect(session.consolePort).toBeGreaterThan(0);
      expect(session.mcpPort).toBeGreaterThan(0);

      const appUrl = new URL(`http://127.0.0.1:${session.appPort}/`);
      const mcpBase = session.mcpUrl!.origin;
      const mcpHost = `127.0.0.1:${session.mcpPort}`;

      // Prompt 24 shape — MCP surface answers on the ephemeral port.
      const health = await fetch(`${mcpBase}/health`, {
        headers: { host: mcpHost },
      });
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true, surface: "mcp" });

      // One real request to the starter's health Flow.
      const appHealth = await fetch(new URL("/health", appUrl));
      expect(appHealth.status).toBe(200);
      const healthBody = (await appHealth.json()) as {
        data: { ok: boolean } | null;
        error: unknown;
      };
      expect(healthBody.error).toBeNull();
      expect(healthBody.data?.ok).toBe(true);

      session.stop();
      session = undefined;

      // All surfaces gone — same assertion Prompt 24 uses for MCP.
      await expect(fetch(`${mcpBase}/health`, { headers: { host: mcpHost } })).rejects.toThrow();
      await expect(fetch(new URL("/health", appUrl))).rejects.toThrow();
    },
    TIMEOUT_MS,
  );
});
