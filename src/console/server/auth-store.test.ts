/**
 * Console auth schema projection — `oke_console` Store browse.
 */

import { describe, expect, test } from "bun:test";
import {
  createApiKeyStore,
  createOperatorInviteStore,
  createOperatorStore,
  createRoleStore,
  createSessionStore,
  upsertRole,
} from "../../auth/index.ts";
import { AUTH_TABLES } from "../../auth/tables.ts";
import { PII_MASK } from "../../elements/store/classify.ts";
import {
  CONSOLE_AUTH_STORE_ENV,
  CONSOLE_AUTH_STORE_REF,
  consoleAuthStoreEnabled,
  isConsoleAuthStoreRef,
  queryConsoleAuthStore,
  rejectConsoleAuthMutation,
  requireConsoleAuthStore,
  type ConsoleAuthStoreSource,
} from "./auth-store.ts";
import { projectStoresList } from "./store.ts";

function source(partial?: Partial<ConsoleAuthStoreSource>): ConsoleAuthStoreSource {
  const operators = createOperatorStore();
  operators.operators.set("op_1", {
    id: "op_1",
    email: "dev@oke.dev",
    name: "Dev",
    status: "active",
    mfaEnabled: false,
    invitedBy: null,
    lastSeenAt: 1,
  });
  operators.credentials.set("op_1", {
    operatorId: "op_1",
    passwordHash: "argon2id$secret",
    loginEnabled: true,
  });
  operators.roles.set("op_1", ["role_ops"]);
  const roles = createRoleStore();
  upsertRole(roles, {
    id: "role_ops",
    name: "ops",
    plane: "operator",
    description: "Console operators",
  });
  roles.grants.set("role_ops", new Set(["console:store.sql:read"]));
  return {
    operators,
    sessions: createSessionStore(),
    roles,
    apiKeys: createApiKeyStore(),
    invites: createOperatorInviteStore(),
    identities: [
      {
        id: "user_demo",
        email: "demo@example.com",
        name: "Demo User",
        status: "active",
        scopes: ["member"],
      },
    ],
    roleMembers: new Map([["role_member", ["user_demo"]]]),
    ...partial,
  };
}

describe("console auth store", () => {
  test("list omits oke_console unless opted in", async () => {
    const hidden = await projectStoresList({
      manifest: {
        oke: "1.0",
        app: "keel",
        stores: { db: { facet: "sql", tables: { issues: {} } } },
      },
      runtime: null,
      declaredFingerprint: "x",
      appliedFingerprint: null,
      includeAuthStore: false,
    });
    expect(hidden.stores.find((s) => s.ref === CONSOLE_AUTH_STORE_REF)).toBeUndefined();
    expect(hidden.stores.find((s) => s.ref === "sql:db")?.children.map((c) => c.name)).toEqual([
      "issues",
      "indexes",
      "functions",
      "triggers",
      "extensions",
      "policies",
    ]);

    const { stores } = await projectStoresList({
      manifest: {
        oke: "1.0",
        app: "keel",
        stores: { db: { facet: "sql", tables: { issues: {} } } },
      },
      runtime: null,
      declaredFingerprint: "x",
      appliedFingerprint: null,
      includeAuthStore: true,
    });
    const auth = stores.find((s) => s.ref === CONSOLE_AUTH_STORE_REF);
    expect(auth?.name).toBe("oke_console");
    expect(auth?.children.map((c) => c.name)).toContain(AUTH_TABLES.operators);
    expect(auth?.children.map((c) => c.name)).toContain(AUTH_TABLES.sessions);
    expect(auth?.children.map((c) => c.name)).toContain("indexes");
    expect(auth?.warnings[0]?.code).toBe("operator-plane");
  });

  test("OKE_CONSOLE_AUTH_STORE=1 opts the auth schema into the list", async () => {
    const prev = process.env[CONSOLE_AUTH_STORE_ENV];
    try {
      process.env[CONSOLE_AUTH_STORE_ENV] = "1";
      expect(consoleAuthStoreEnabled()).toBe(true);
      const { stores } = await projectStoresList({
        manifest: { oke: "1.0", app: "keel", stores: {} },
        runtime: null,
        declaredFingerprint: "x",
        appliedFingerprint: null,
      });
      expect(stores.some((s) => s.ref === CONSOLE_AUTH_STORE_REF)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env[CONSOLE_AUTH_STORE_ENV];
      else process.env[CONSOLE_AUTH_STORE_ENV] = prev;
    }
  });

  test("browse is refused until OKE_CONSOLE_AUTH_STORE=1", () => {
    expect(consoleAuthStoreEnabled({})).toBe(false);
    expect(consoleAuthStoreEnabled({ [CONSOLE_AUTH_STORE_ENV]: "1" })).toBe(true);
    expect(consoleAuthStoreEnabled({ [CONSOLE_AUTH_STORE_ENV]: "true" })).toBe(true);
    expect(() => requireConsoleAuthStore({})).toThrow(/hidden unless/);
    expect(() => requireConsoleAuthStore({ [CONSOLE_AUTH_STORE_ENV]: "1" })).not.toThrow();
  });

  test("query masks credential hashes until reveal", () => {
    const src = source();
    const masked = queryConsoleAuthStore(src, {
      ref: CONSOLE_AUTH_STORE_REF,
      child: AUTH_TABLES.operatorCredentials,
    });
    expect(masked.rows?.[0]?.password_hash).toBe(PII_MASK);
    expect(masked.masked).toBe(true);

    const clear = queryConsoleAuthStore(src, {
      ref: CONSOLE_AUTH_STORE_REF,
      child: AUTH_TABLES.operatorCredentials,
      revealPii: true,
    });
    expect(clear.rows?.[0]?.password_hash).toBe("argon2id$secret");
    expect(clear.masked).toBe(false);
  });

  test("query projects operators, identities, and roles", () => {
    const src = source();
    const ops = queryConsoleAuthStore(src, {
      ref: CONSOLE_AUTH_STORE_REF,
      child: AUTH_TABLES.operators,
      revealPii: true,
    });
    expect(ops.rows?.[0]?.email).toBe("dev@oke.dev");

    const identities = queryConsoleAuthStore(src, {
      ref: CONSOLE_AUTH_STORE_REF,
      child: AUTH_TABLES.identities,
      revealPii: true,
    });
    expect(identities.rows?.[0]?.id).toBe("user_demo");

    const roles = queryConsoleAuthStore(src, {
      ref: CONSOLE_AUTH_STORE_REF,
      child: AUTH_TABLES.roles,
    });
    expect(roles.rows?.some((r) => r.id === "role_ops")).toBe(true);
  });

  test("catalog folders project Manifest-style indexes and empty functions", () => {
    const src = source();
    const indexes = queryConsoleAuthStore(src, {
      ref: CONSOLE_AUTH_STORE_REF,
      child: "indexes",
    });
    expect(indexes.rows?.some((r) => r.table === AUTH_TABLES.operators)).toBe(true);
    expect(indexes.masked).toBe(false);

    const functions = queryConsoleAuthStore(src, {
      ref: CONSOLE_AUTH_STORE_REF,
      child: "functions",
    });
    expect(functions.rows).toEqual([]);

    const triggers = queryConsoleAuthStore(src, {
      ref: CONSOLE_AUTH_STORE_REF,
      child: "triggers",
    });
    expect(triggers.rows).toEqual([]);

    const extensions = queryConsoleAuthStore(src, {
      ref: CONSOLE_AUTH_STORE_REF,
      child: "extensions",
    });
    expect(extensions.rows?.some((r) => r.name === "plpgsql")).toBe(true);

    const policies = queryConsoleAuthStore(src, {
      ref: CONSOLE_AUTH_STORE_REF,
      child: "policies",
    });
    expect(policies.rows).toEqual([]);
  });

  test("mutations against oke_console are refused", () => {
    expect(isConsoleAuthStoreRef(CONSOLE_AUTH_STORE_REF)).toBe(true);
    expect(isConsoleAuthStoreRef("sql:db")).toBe(false);
    expect(() => rejectConsoleAuthMutation(CONSOLE_AUTH_STORE_REF)).toThrow(/read-only/);
    expect(() => rejectConsoleAuthMutation("sql:db")).not.toThrow();
  });
});
