/**
 * Auth acceptance:
 * - API key cannot exceed creator scopes
 * - cross-plane: application principal → console flow is a compile error
 * - hybrid sessions rotate refresh tokens with reuse detection
 * - operator local credential cannot be removed; SSO is additive
 * - invoke-as attenuated like an API key
 * - roles are data
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../manifest/types.ts";
import {
  assertAttenuated,
  assertCrossPlane,
  AttenuationError,
  authenticateOperator,
  auth,
  checkCrossPlane,
  createApiKey,
  createApiKeyStore,
  createOperator,
  createOperatorStore,
  createRoleStore,
  createSessionStore,
  CrossPlaneError,
  invokeAs,
  issueSessionWithScopes,
  linkOperatorSso,
  removeOperatorCredential,
  rotateRefresh,
  setRoleGrants,
  scopesForRoles,
  SessionError,
  upsertRole,
  userPrincipal,
  assertPlaneAccess,
} from "./index.ts";

describe("auth plugin", () => {
  test("registers oke_ tables on both planes", () => {
    const tables: string[] = [];
    auth({ secret: "test" }).register({
      hook() {
        return this;
      },
      edge() {
        return this;
      },
      decorate() {
        return this;
      },
      element() {
        return this;
      },
      needs() {
        return this;
      },
      errors() {
        return this;
      },
      consolePanel() {
        return this;
      },
      cli() {
        return this;
      },
      driver() {
        return this;
      },
      image() {
        return this;
      },
      table(name) {
        tables.push(name);
        return this;
      },
      binding() {
        return this;
      },
      flow() {
        return this;
      },
      client() {
        return this;
      },
      config() {
        return this;
      },
      vault() {
        return this;
      },
      clock() {
        return this;
      },
      signal() {
        return this;
      },
      gate() {
        return this;
      },
      channelTemplate() {
        return this;
      },
      channelCatalog() {
        return this;
      },
    });
    expect(tables).toContain("oke_operators");
    expect(tables).toContain("oke_operator_credentials");
    expect(tables).toContain("oke_identities");
    expect(tables).toContain("oke_api_keys");
    expect(tables).toContain("oke_refresh_tokens");
  });
});

describe("API key attenuation", () => {
  test("key cannot be created with a scope its creator lacks", async () => {
    const store = createApiKeyStore();
    const creatorScopes = new Set(["bookings:create", "bookings:list"]);

    await expect(
      createApiKey(store, {
        plane: "user",
        name: "escalated",
        scopes: ["bookings:create", "admin:all"],
        creatorId: "u1",
        creatorScopes,
      }),
    ).rejects.toBeInstanceOf(AttenuationError);

    const ok = await createApiKey(store, {
      plane: "user",
      name: "ok",
      scopes: ["bookings:list"],
      creatorId: "u1",
      creatorScopes,
    });
    expect(ok.row.scopes).toEqual(["bookings:list"]);
    expect(ok.secret.startsWith("oke_")).toBe(true);
    expect(ok.row.createdAt).toBeGreaterThan(0);
    expect(ok.row.revokedAt).toBeNull();
  });

  test("revoke and rotate — secret once on rotate", async () => {
    const { revokeApiKey, rotateApiKey } = await import("./api-keys.ts");
    const store = createApiKeyStore();
    const created = await createApiKey(store, {
      plane: "user",
      name: "rot",
      scopes: ["bookings:list"],
      creatorId: "u1",
      creatorScopes: ["bookings:list"],
    });
    const rotated = await rotateApiKey(store, created.row.id);
    expect(rotated?.secret).toBeTruthy();
    expect(rotated?.secret).not.toBe(created.secret);
    const revoked = revokeApiKey(store, created.row.id);
    expect(revoked?.revokedAt).not.toBeNull();
    expect(await rotateApiKey(store, created.row.id)).toBeNull();
  });
});

describe("cross-plane compile error", () => {
  test("application principal reaching a console flow is a compile error", () => {
    const manifest: Manifest = {
      oke: "1.0",
      app: "skyport",
      flows: {
        "bookings.create": { plane: "user", effects: { calls: ["console.store.query"] } },
        "console.store.query": { plane: "operator" },
      },
    };

    const diags = checkCrossPlane(manifest, [
      {
        path: "src/flows/console/store.ts",
        flow: "console.store.query",
        source: `
          export const query = flow("console.store.query", {
            plane: "operator",
            do: (_i, fx) => fx.auth.userId,
          });
        `,
      },
    ]);

    expect(diags.some((d) => d.message.includes("fx.auth"))).toBe(true);
    expect(diags.some((d) => d.message.includes("cross-plane call"))).toBe(true);

    expect(() =>
      assertCrossPlane(manifest, [
        {
          path: "x.ts",
          flow: "console.store.query",
          source: `plane: "operator"; fx.auth.userId`,
        },
      ]),
    ).toThrow(CrossPlaneError);

    const user = userPrincipal({ userId: "u1", scopes: ["bookings:create"] });
    expect(() => assertPlaneAccess(user, "operator")).toThrow(CrossPlaneError);
  });
});

describe("hybrid sessions", () => {
  test("rotate refresh tokens with reuse detection", async () => {
    const store = createSessionStore();
    let now = 1_000_000;
    const crypto = { secret: "test-secret", now: () => now };

    const issued = await issueSessionWithScopes(store, crypto, {
      id: "user-1",
      plane: "user",
      scopes: ["bookings:create"],
    });

    now += 1_000;
    const rotated = await rotateRefresh(store, crypto, issued.refreshToken);
    expect(rotated.refreshToken).not.toBe(issued.refreshToken);
    expect(rotated.accessToken).not.toBe(issued.accessToken);

    // Reuse of the old refresh token revokes the family.
    await expect(rotateRefresh(store, crypto, issued.refreshToken)).rejects.toMatchObject({
      name: "SessionError",
    });

    // Family revoked — the rotated refresh is also dead.
    await expect(rotateRefresh(store, crypto, rotated.refreshToken)).rejects.toBeInstanceOf(
      SessionError,
    );
  });

  test("scopes and audience survive on the session row across store instances", async () => {
    const store = createSessionStore();
    let now = 2_000_000;
    const crypto = {
      secret: "test-secret",
      now: () => now,
      audience: "oke-app",
    };
    const issued = await issueSessionWithScopes(store, crypto, {
      id: "user-2",
      plane: "user",
      scopes: ["notes:write", "notes:read"],
    });
    expect(issued.session.scopes).toEqual(["notes:write", "notes:read"]);
    expect(issued.session.audience).toBe("oke-app");

    // Simulate process restart: copy rows into a fresh SessionStore (no module Maps).
    const restored = createSessionStore();
    for (const [id, row] of store.sessions) {
      restored.sessions.set(id, { ...row, scopes: [...row.scopes] });
    }
    for (const [id, row] of store.refresh) {
      restored.refresh.set(id, { ...row });
    }

    now += 1_000;
    const rotated = await rotateRefresh(restored, crypto, issued.refreshToken);
    const { verifyAccess } = await import("./sessions.ts");
    const claims = await verifyAccess(restored, crypto.secret, rotated.accessToken, {
      now: () => now,
      audience: "oke-app",
    });
    expect(claims.scopes).toEqual(["notes:write", "notes:read"]);
    expect(claims.aud).toBe("oke-app");
  });
});

describe("operator plane", () => {
  test("local credential cannot be removed; SSO is additive", async () => {
    const store = createOperatorStore();
    const op = await createOperator(store, {
      email: "ops@example.com",
      name: "Ops",
      password: "Correct Horse Battery Staple 1!",
    });

    expect(store.credentials.has(op.id)).toBe(true);
    expect(() => removeOperatorCredential(store, op.id)).toThrow(/cannot be removed/);
    expect(store.credentials.has(op.id)).toBe(true);

    linkOperatorSso(store, op.id, "oidc", "sub-123");
    expect(store.ssoLinks.get(op.id)).toHaveLength(1);
    // Local login still works after SSO link.
    const authed = await authenticateOperator(
      store,
      "ops@example.com",
      "Correct Horse Battery Staple 1!",
    );
    expect(authed?.id).toBe(op.id);
  });
});

describe("invoke-as attenuation", () => {
  test("attenuated exactly like an API key", () => {
    const operatorScopes = new Set(["bookings:create", "bookings:list"]);

    expect(() =>
      invokeAs({
        operatorScopes,
        scopes: ["bookings:create", "admin:all"],
        userId: "synthetic-1",
      }),
    ).toThrow(AttenuationError);

    const principal = invokeAs({
      operatorScopes,
      scopes: ["bookings:create"],
      userId: "synthetic-1",
    });
    expect(principal.plane).toBe("user");
    expect(principal.scopes.has("bookings:create")).toBe(true);

    expect(() =>
      invokeAs({
        operatorScopes,
        scopes: ["bookings:create"],
        userId: "real-user",
        impersonateRealUser: true,
        development: false,
      }),
    ).toThrow(/development-only/);
  });
});

describe("roles are data", () => {
  test("grants assignable without redeploy", () => {
    const store = createRoleStore();
    upsertRole(store, {
      id: "r1",
      name: "agent",
      plane: "user",
      description: "support agent",
    });
    setRoleGrants(store, "r1", ["bookings:list", "bookings:create"]);
    const scopes = scopesForRoles(store, ["r1"], "user");
    expect(scopes.has("bookings:list")).toBe(true);
    // Plane isolation: operator roles ignored for user resolution.
    upsertRole(store, {
      id: "r-ops",
      name: "admin",
      plane: "operator",
      description: "ops",
    });
    setRoleGrants(store, "r-ops", ["console:store.sql:write"]);
    expect(scopesForRoles(store, ["r-ops"], "user").size).toBe(0);
  });

  test("assertAttenuated helper", () => {
    expect(() => assertAttenuated(new Set(["a"]), ["a", "b"], "api key")).toThrow(/missing: b/);
  });
});
