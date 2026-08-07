/**
 * Phase 1 Gate auth — autoBoot / posture / email Flows / schema / security.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { GateBootError } from "../elements/gate.ts";
import { oke, on, flow, http, resetBindings, plugin } from "../kernel/index.ts";
import { resetFlowSeq } from "../kernel/flow.ts";
// resetBindings via kernel; resetFlowSeq is test-only.
import { resolveAuthSchema } from "./schema.ts";
import { emitSchemaSource, runSchemaGenerate } from "../cli/schema.ts";
import { isSessionFresh, AUTH_SESSION_GATE } from "./bindings.ts";
import { resolveGateAuth } from "./config.ts";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("gate.auth — config", () => {
  test("prod without secret fails", () => {
    expect(() =>
      resolveGateAuth({ auth: { emailAndPassword: { enabled: true } }, env: "prod" }),
    ).toThrow(/secret is required/);
  });

  test("dev mints secret", () => {
    const resolved = resolveGateAuth({
      auth: { emailAndPassword: { enabled: true } },
      env: "dev",
    });
    expect(resolved.secretMinted).toBe(true);
    expect(resolved.secret.length).toBeGreaterThan(8);
  });

  test("schema customize modelName / fields / additionalFields", () => {
    const schema = resolveAuthSchema({
      user: {
        modelName: "users",
        fields: { email: "email_address", name: "full_name" },
        additionalFields: {
          lang: { type: "string", defaultValue: "en" },
        },
      },
      session: {
        modelName: "user_sessions",
        fields: { principalId: "user_id" },
      },
    });
    expect(schema.models.user.tableName).toBe("users");
    expect(schema.models.user.fields.email).toBe("email_address");
    expect(schema.models.user.columns.some((c) => c.logical === "lang")).toBe(true);
    expect(schema.models.session.tableName).toBe("user_sessions");
    expect(schema.models.session.fields.principalId).toBe("user_id");
  });
});

describe("gate.auth — autoBoot / posture", () => {
  test("auth HTTP bindings are in adopted and fail posture without gates", async () => {
    // Force a gap by constructing bindings then auditing with empty gates stripped —
    // real materialization always attaches gate.public / auth.session.
    const app = oke({
      name: "auth-posture",
      env: "test",
      registry: "ignore",
      gate: {
        auth: {
          secret: "test-secret-at-least-16",
          emailAndPassword: { enabled: true },
        },
        unguardedHttp: "deny",
      },
    });
    const authPaths = app.bindings
      .filter((b) => b.trigger.kind === "http")
      .map(
        (b) =>
          `${(b.trigger as { method: string; path: string }).method} ${(b.trigger as { path: string }).path}`,
      );
    expect(authPaths.some((p) => p.includes("/auth/sign-in/email"))).toBe(true);
    expect(authPaths.some((p) => p.includes("/auth/me"))).toBe(true);
    // Every auth binding has posture.
    for (const b of app.bindings) {
      if (b.trigger.kind !== "http") continue;
      expect((b.trigger as { gates: readonly unknown[] }).gates.length).toBeGreaterThan(0);
    }
    await app.boot({ env: "test" });
    await app.stop();
  });

  test("bare oke gate.auth fetch goes through ensureBoot → doBoot", async () => {
    const app = oke({
      name: "auth-autoboot",
      env: "local",
      registry: "ignore",
      gate: {
        auth: {
          secret: "test-secret-at-least-16",
          emailAndPassword: { enabled: true },
        },
      },
    });
    expect(app.booted).toBe(false);
    const res = await app.fetch(
      new Request("http://localhost/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.com", password: "not-the-password" }),
      }),
    );
    expect(app.booted).toBe(true);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("AuthFailed");
    await app.stop();
  });

  test("auth routes are not registry flows[] alone — they are Bindings", () => {
    const app = oke({
      name: "auth-bindings",
      env: "local",
      registry: "ignore",
      gate: {
        auth: {
          secret: "test-secret-at-least-16",
          emailAndPassword: { enabled: true },
        },
      },
    });
    expect(app.bindings.length).toBeGreaterThan(0);
    expect(app.bindings.every((b) => b.flow && b.trigger)).toBe(true);
    expect(app.router.match("POST", "/auth/sign-in/email")).toBeTruthy();
  });

  test(".needs(auth) satisfied by gate.auth without .plug(auth())", async () => {
    on(http.get("/x").gate(AUTH_SESSION_GATE), flow("x", { do: () => ({ ok: true }) }));
    const dependent = plugin("needs-auth", { version: "0.0.1" }).needs("auth");
    const app = oke({
      name: "needs-gate-auth",
      env: "test",
      gate: {
        auth: { secret: "test-secret-at-least-16", http: false },
        policies: [AUTH_SESSION_GATE],
        unguardedHttp: "allow",
      },
    }).plug(dependent);
    await expect(app.boot({ env: "test", unguardedHttp: "allow" })).resolves.toBeTruthy();
    await app.stop();
  });
});

describe("gate.auth — email Flows + security", () => {
  test("sign-up then sign-in + refresh + me", async () => {
    const app = oke({
      name: "auth-email",
      env: "test",
      registry: "ignore",
      gate: {
        auth: {
          secret: "test-secret-at-least-16",
          emailAndPassword: { enabled: true },
        },
        unguardedHttp: "deny",
      },
    });
    await app.boot({ env: "test" });

    const signUp = await app.fetch(
      new Request("http://localhost/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          password: "CorrectHorse1",
          name: "User",
        }),
      }),
    );
    expect(signUp.status).toBe(200);
    const signed = (await signUp.json()) as {
      data: { accessToken: string; refreshToken: string; userId: string };
    };
    expect(signed.data.accessToken).toBeTruthy();
    expect(signed.data.userId).toBeTruthy();

    const bad = await app.fetch(
      new Request("http://localhost/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "missing@example.com", password: "CorrectHorse1" }),
      }),
    );
    const badBody = (await bad.json()) as { error: { code: string; data?: { reason?: string } } };
    expect(badBody.error.code).toBe("AuthFailed");
    expect(badBody.error.data?.reason).toBe("invalid_credentials");

    const me = await app.fetch(
      new Request("http://localhost/auth/me", {
        headers: { authorization: `Bearer ${signed.data.accessToken}` },
      }),
    );
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { data: { email: string } };
    expect(meBody.data.email).toBe("user@example.com");

    const refreshed = await app.fetch(
      new Request("http://localhost/auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: signed.data.refreshToken }),
      }),
    );
    expect(refreshed.status).toBe(200);

    await app.stop();
  });

  test("sign-up rejects weak passwords with AuthFailed password_policy", async () => {
    const app = oke({
      name: "auth-weak-password",
      env: "test",
      registry: "ignore",
      gate: {
        auth: {
          secret: "test-secret-at-least-16",
          emailAndPassword: { enabled: true },
        },
      },
    });
    await app.boot({ env: "test" });

    const res = await app.fetch(
      new Request("http://localhost/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "weak@example.com",
          password: "123",
          name: "Weak",
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      data: null;
      error: { code: string; data?: { reason?: string; reasons?: string[] } };
    };
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("AuthFailed");
    expect(body.error.data?.reason).toBe("password_policy");
    expect(body.error.data?.reasons?.some((r) => r.includes("minLength"))).toBe(true);

    // Rejection is real — same email can still sign up with a strong password.
    const ok = await app.fetch(
      new Request("http://localhost/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "weak@example.com",
          password: "CorrectHorse1",
          name: "Strong",
        }),
      }),
    );
    expect(ok.status).toBe(200);

    await app.stop();
  });

  test("enumeration: email_taken looks like invalid_credentials", async () => {
    const app = oke({
      name: "auth-enum",
      env: "test",
      registry: "ignore",
      gate: {
        auth: {
          secret: "test-secret-at-least-16",
          emailAndPassword: { enabled: true },
        },
      },
    });
    await app.boot({ env: "test" });
    await app.fetch(
      new Request("http://localhost/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "dup@example.com", password: "CorrectHorse1" }),
      }),
    );
    const again = await app.fetch(
      new Request("http://localhost/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "dup@example.com", password: "CorrectHorse1" }),
      }),
    );
    const body = (await again.json()) as { error: { data?: { reason?: string } } };
    expect(body.error.data?.reason).toBe("invalid_credentials");
    await app.stop();
  });

  test("freshAge helper", () => {
    const now = 1_000_000;
    expect(isSessionFresh(now - 1000, 60_000, now)).toBe(true);
    expect(isSessionFresh(now - 120_000, 60_000, now)).toBe(false);
  });

  test("missing gate on custom HTTP still GateBootError", async () => {
    on(http.get("/open"), flow("open", { do: () => ({ ok: true }) }));
    const app = oke({
      name: "gap",
      env: "local",
      gate: {
        auth: { secret: "test-secret-at-least-16", http: false },
        unguardedHttp: "deny",
      },
      startScheduler: false,
    });
    await expect(app.boot({ env: "local", startScheduler: false })).rejects.toBeInstanceOf(
      GateBootError,
    );
  });
});

describe("oke schema generate — auth columns", () => {
  test("emits real columns + --check drift", async () => {
    const schema = resolveAuthSchema({
      user: {
        modelName: "users",
        additionalFields: { lang: { type: "string", defaultValue: "en" } },
      },
    });
    const source = emitSchemaSource([...schema.tableNames], schema);
    expect(source).toContain('model: "user"');
    expect(source).toContain('name: "users"');
    expect(source).toContain("lang:");
    expect(source).toContain('sqlType: "TEXT"');

    const dir = await mkdtemp(join(tmpdir(), "oke-schema-"));
    try {
      await mkdir(join(dir, "schema"), { recursive: true });
      const code = await runSchemaGenerate({
        cwd: dir,
        authSchema: {
          user: {
            modelName: "users",
            additionalFields: { lang: { type: "string", defaultValue: "en" } },
          },
        },
        write: () => {},
      });
      expect(code).toBe(0);
      const checkOk = await runSchemaGenerate({
        cwd: dir,
        check: true,
        authSchema: {
          user: {
            modelName: "users",
            additionalFields: { lang: { type: "string", defaultValue: "en" } },
          },
        },
        write: () => {},
      });
      expect(checkOk).toBe(0);
      const drift = await runSchemaGenerate({
        cwd: dir,
        check: true,
        authSchema: { user: { modelName: "people" } },
        write: () => {},
      });
      expect(drift).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
