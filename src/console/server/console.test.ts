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
import { createConsoleApp } from "./app.ts";
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
      });
      const { data, error } = await api.console.setupStatus({});
      expect(error).toBeNull();
      expect(data?.setupClosed).toBe(false);
      expect(data?.claimRequired).toBe(true);
    } finally {
      await handle.app.stop();
    }
  });

  test("claim rejects weak passwords with ClaimFailed password_policy (not 500)", async () => {
    const handle = await startConsoleApp({
      cwd,
      secret: "test-secret-console",
      silentClaim: true,
    });
    try {
      const weak = await handle.app.fetch(
        new Request("http://console.test/console/setup/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claimCode: handle.state.claim.code,
            email: "ops@example.com",
            name: "Ops",
            password: "short1A",
          }),
        }),
      );
      // Zod min(12) rejects before createOperator — still not an opaque 500.
      expect(weak.status).toBe(422);
      const shortOkZod = await handle.app.fetch(
        new Request("http://console.test/console/setup/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claimCode: handle.state.claim.code,
            email: "ops@example.com",
            name: "Ops",
            password: "longenoughword",
          }),
        }),
      );
      expect(shortOkZod.status).toBe(400);
      const body = (await shortOkZod.json()) as {
        error: { code: string; message?: string; data?: { reason?: string } };
      };
      expect(body.error.code).toBe("ClaimFailed");
      expect(body.error.data?.reason).toBe("password_policy");
      expect(body.error.message).toMatch(/12 characters/i);

      // Former default-policy password (letter+number, no upper/special) must fail Console policy.
      const oldDefault = await handle.app.fetch(
        new Request("http://console.test/console/setup/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claimCode: handle.state.claim.code,
            email: "ops@example.com",
            name: "Ops",
            password: "password1234",
          }),
        }),
      );
      expect(oldDefault.status).toBe(400);
      const oldBody = (await oldDefault.json()) as {
        error: { code: string; data?: { reason?: string } };
      };
      expect(oldBody.error.code).toBe("ClaimFailed");
      expect(oldBody.error.data?.reason).toBe("password_policy");

      // Length-ok but missing ONLY a special character must fail Console policy.
      const noSpecial = await handle.app.fetch(
        new Request("http://console.test/console/setup/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claimCode: handle.state.claim.code,
            email: "ops@example.com",
            name: "Ops",
            password: "Password1234",
          }),
        }),
      );
      expect(noSpecial.status).toBe(400);
      const noSpecialBody = (await noSpecial.json()) as {
        error: { code: string; data?: { reason?: string; reasons?: string[] } };
      };
      expect(noSpecialBody.error.code).toBe("ClaimFailed");
      expect(noSpecialBody.error.data?.reason).toBe("password_policy");
      expect(noSpecialBody.error.data?.reasons).toContain("requireSpecial");
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
            password: "Password1234!",
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
            password: "Password1234!",
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
            password: "Password1234!",
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
            password: "Password1234!",
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
            password: "Password1234!",
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
      env: "test",
      // Security suite is hermetic — do not inherit a host DATABASE_URL.
      persist: false,
    });
  });

  afterAll(() => {
    server?.stop(true);
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
    expect(csp).toContain("frame-src 'self' blob:");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("media-src 'self' blob:");
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
          password: "Password1234!",
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

  test("claim succeeds when a stale session cookie is present", async () => {
    const claimCwd = await mkdtemp(join(tmpdir(), "oke-console-stale-claim-"));
    const claimServer = await serveConsole({
      port: 0,
      hostname: "127.0.0.1",
      cwd: claimCwd,
      secret: "stale-claim-secret",
      silentClaim: true,
      env: "test",
      persist: false,
    });
    try {
      const res = await claimServer.fetch(
        new Request(`${claimServer.url}console/setup/claim`, {
          method: "POST",
          headers: {
            host: "127.0.0.1",
            "content-type": "application/json",
            // Leftover HttpOnly cookie from a prior Console session — withCookieAuth
            // injects Bearer, and public-flow onRequest must strip it without
            // re-wrapping the already-parsed body stream.
            cookie: "oke_console_at=stale.forged.token",
          },
          body: JSON.stringify({
            claimCode: claimServer.console.state.claim.code,
            email: "fresh@example.com",
            name: "Fresh",
            password: "Password1234!",
          }),
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { accessToken: string; email: string } | null;
        error: { message?: string } | null;
      };
      expect(body.error).toBeNull();
      expect(body.data?.email).toBe("fresh@example.com");
      expect(body.data?.accessToken).toBeTruthy();
    } finally {
      claimServer.stop(true);
    }
  });

  test("unknown Console paths are 404, not rewritten", async () => {
    const headers = { host: "127.0.0.1" };
    const overview = await server.fetch(new Request(`${server.url}overview`, { headers }));
    expect(overview.status).toBe(200);
    const units = await server.fetch(new Request(`${server.url}units`, { headers }));
    expect(units.status).toBe(404);
    expect(await units.text()).toMatch(/404|not a Console page|<!doctype html>/i);
    const junk = await server.fetch(new Request(`${server.url}nope`, { headers }));
    expect(junk.status).toBe(404);
  });

  test("plugin iframe sandbox omits allow-same-origin", () => {
    expect(PLUGIN_IFRAME_SANDBOX.includes("allow-same-origin")).toBe(false);
    expect(PLUGIN_IFRAME_SANDBOX).toContain("allow-scripts");
  });
});

describe("console boot under oke dev compose env", () => {
  /**
   * Isolate from compose URLs — this suite proves capability minting, not
   * driver wiring. `serveConsole` passes the same `docker: false` flag.
   */
  const isolatedDevConfig = {
    drivers: {
      store: {
        sql: { dev: "memory" },
        kv: { dev: "memory" },
        files: { dev: "memory" },
        index: { dev: "memory" },
      },
      signal: { dev: "memory" },
      clock: { dev: "frozen" },
      journal: { dev: "memory" },
      vault: { dev: "memory" },
      channel: { email: { dev: "console" } },
      ai: { dev: "mock" },
    },
  } as const;

  test("docker:true + env:dev hard-fails OKE1008 on undeclared console flows", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-docker-strict-"));
    const handle = createConsoleApp({
      cwd,
      secret: "compose-dev-secret",
      silentClaim: true,
    });
    await expect(
      handle.app.boot({ env: "dev", docker: true, config: isolatedDevConfig }),
    ).rejects.toThrow(/OKE1008/);
  });

  test("docker:false + env:dev boots even when OKE_DOCKER=1 (serveConsole contract)", async () => {
    const prev = process.env.OKE_DOCKER;
    process.env.OKE_DOCKER = "1";
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-docker-open-"));
    const handle = createConsoleApp({
      cwd,
      secret: "compose-dev-secret",
      silentClaim: true,
    });
    try {
      // Same flags `serveConsole` now passes — must not inherit OKE_DOCKER=1.
      await handle.app.boot({ env: "dev", docker: false, config: isolatedDevConfig });
      const res = await handle.app.fetch(new Request("http://console.test/console/setup/status"));
      expect(res.status).toBe(200);
    } finally {
      await handle.app.stop();
      if (prev === undefined) delete process.env.OKE_DOCKER;
      else process.env.OKE_DOCKER = prev;
    }
  });
});
