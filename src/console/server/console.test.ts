/**
 * Console kernel acceptance:
 * - every action appears in a trace
 * - setup wizard cannot be reopened after first operator
 * - console flow unreachable by an application principal
 * - Host/Origin + CSP + SameSite=Strict
 * - structural changes land as diffs, never applied silently
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueSession } from "../../auth/index.ts";
import { createClient } from "../../client/index.ts";
import { CONSOLE_CSP, PLUGIN_IFRAME_SANDBOX } from "./security-headers.ts";
import { serveConsole, type ConsoleServerHandle } from "./serve.ts";
import { startConsoleApp } from "./serve.ts";

describe("console kernel", () => {
  let cwd: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), "oke-console-"));
  });

  test("createClient<ConsoleApp> reaches setup.status", async () => {
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-console",
      silentClaim: true,
    });
    try {
      const api = createClient(handle.app, "http://console.test", {
        fetch: async (input, init) => {
          const req = new Request(String(input), init);
          return handle.app.fetch(req);
        },
      }) as {
        console: {
          setupStatus: (input?: unknown) => Promise<{
            data: { setupClosed: boolean; claimRequired: boolean } | null;
            error: { code: string } | null;
          }>;
        };
      };
      const { data, error } = await api.console.setupStatus({});
      expect(error).toBeNull();
      expect(data?.setupClosed).toBe(false);
      expect(data?.claimRequired).toBe(true);
    } finally {
      await handle.app.stop();
    }
  });

  test("claim creates first operator and closes the wizard permanently", async () => {
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-console",
      silentClaim: true,
    });
    try {
      const code = handle.state.claim.code;
      const claimRes = await handle.app.fetch(
        new Request("http://console.test/console/setup/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claimCode: code,
            email: "ops@example.com",
            name: "Ops",
            password: "password123",
          }),
        }),
      );
      expect(claimRes.status).toBe(200);
      const claimBody = (await claimRes.json()) as {
        data: { accessToken: string; operatorId: string };
        error: null;
      };
      expect(claimBody.data.accessToken).toBeTruthy();
      expect(handle.state.setupClosed).toBe(true);

      const reopen = await handle.app.fetch(
        new Request("http://console.test/console/setup/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claimCode: code,
            email: "other@example.com",
            name: "Other",
            password: "password123",
          }),
        }),
      );
      expect(reopen.status).toBe(400);
      const reopenBody = (await reopen.json()) as {
        error: { code: string };
      };
      expect(reopenBody.error.code).toBe("SetupClosed");

      const status = await handle.app.fetch(
        new Request("http://console.test/console/setup/status"),
      );
      const statusBody = (await status.json()) as {
        data: { setupClosed: boolean; claimRequired: boolean };
      };
      expect(statusBody.data.setupClosed).toBe(true);
      expect(statusBody.data.claimRequired).toBe(false);
    } finally {
      await handle.app.stop();
    }
  });

  test("every console action appears in a trace (runs)", async () => {
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-console",
      silentClaim: true,
    });
    try {
      const claimRes = await handle.app.fetch(
        new Request("http://console.test/console/setup/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claimCode: handle.state.claim.code,
            email: "ops@example.com",
            name: "Ops",
            password: "password123",
          }),
        }),
      );
      const { data } = (await claimRes.json()) as {
        data: { accessToken: string };
      };

      const ping = await handle.app.fetch(
        new Request("http://console.test/console/action/ping", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${data.accessToken}`,
          },
          body: JSON.stringify({ note: "hello-trace" }),
        }),
      );
      expect(ping.status).toBe(200);

      const runs = await handle.state.listRuns();
      const names = runs.map((r) => r.flow);
      expect(names).toContain("console.setup.claim");
      expect(names).toContain("console.action.ping");
      const pingRun = runs.find((r) => r.flow === "console.action.ping");
      expect(pingRun?.plane).toBe("operator");
      expect(pingRun?.logs.some((l) => l.message.includes("console.action.ping"))).toBe(true);
    } finally {
      await handle.app.stop();
    }
  });

  test("console flow is unreachable by an application principal", async () => {
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-console",
      silentClaim: true,
    });
    try {
      // Seed an operator so protected flows require auth (not public).
      await handle.app.fetch(
        new Request("http://console.test/console/setup/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claimCode: handle.state.claim.code,
            email: "ops@example.com",
            name: "Ops",
            password: "password123",
          }),
        }),
      );

      const userSession = await issueSession(
        handle.state.sessions,
        { secret: handle.state.secret, now: handle.state.now },
        {
          id: "user-1",
          plane: "user",
          scopes: ["bookings:create"],
        },
      );

      const res = await handle.app.fetch(
        new Request("http://console.test/console/action/ping", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${userSession.accessToken}`,
          },
          body: JSON.stringify({ note: "escalate" }),
        }),
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("Forbidden");
    } finally {
      await handle.app.stop();
    }
  });

  test("structural propose writes a diff and does not apply it", async () => {
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-console",
      silentClaim: true,
    });
    try {
      const claimRes = await handle.app.fetch(
        new Request("http://console.test/console/setup/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claimCode: handle.state.claim.code,
            email: "ops@example.com",
            name: "Ops",
            password: "password123",
          }),
        }),
      );
      const { data } = (await claimRes.json()) as {
        data: { accessToken: string };
      };

      const propose = await handle.app.fetch(
        new Request("http://console.test/console/structural/propose", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${data.accessToken}`,
          },
          body: JSON.stringify({
            title: "raise retries",
            relativePath: "src/signals.ts",
            contents: "export const retries = 5;\n",
            reason: "incident response",
          }),
        }),
      );
      expect(propose.status).toBe(200);
      const body = (await propose.json()) as {
        data: { id: string; path: string; applied: boolean };
      };
      expect(body.data.applied).toBe(false);
      const file = Bun.file(body.data.path);
      expect(await file.exists()).toBe(true);
      const text = await file.text();
      expect(text).toContain("status: proposed — not applied");
      expect(text).toContain("+export const retries = 5;");
      // Target path must not have been silently written.
      expect(await Bun.file(join(cwd, "src/signals.ts")).exists()).toBe(false);
    } finally {
      await handle.app.stop();
    }
  });
});

describe("console serve security", () => {
  let server: ConsoleServerHandle;
  let cwd: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), "oke-console-serve-"));
    server = await serveConsole({
      port: 0,
      hostname: "127.0.0.1",
      cwd,
      secret: "serve-secret",
      silentClaim: true,
      env: "dev",
    });
  });

  afterAll(() => {
    server.stop(true);
  });

  test("rejects unexpected Host", async () => {
    const res = await server.fetch(
      new Request(`${server.url}console/setup/status`, {
        headers: { host: "evil.example" },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("sets CSP with frame-ancestors none", async () => {
    const res = await server.fetch(
      new Request(`${server.url}console/setup/status`, {
        headers: { host: "127.0.0.1" },
      }),
    );
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toBe(CONSOLE_CSP);
  });

  test("claim sets SameSite=Strict session cookies", async () => {
    const res = await server.fetch(
      new Request(`${server.url}console/setup/claim`, {
        method: "POST",
        headers: {
          host: "127.0.0.1",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          claimCode: server.console.state.claim.code,
          email: "ops@example.com",
          name: "Ops",
          password: "password123",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie?.() ?? [];
    const joined = cookies.join("\n");
    expect(joined).toContain("SameSite=Strict");
    expect(joined).toContain("HttpOnly");
    expect(joined).toContain("oke_console_at=");
  });

  test("plugin iframe sandbox omits allow-same-origin", () => {
    expect(PLUGIN_IFRAME_SANDBOX.includes("allow-same-origin")).toBe(false);
    expect(PLUGIN_IFRAME_SANDBOX).toContain("allow-scripts");
  });
});
