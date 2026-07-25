/**
 * Console Access projection — planes, attenuation, blast radius, provenance.
 */

import { describe, expect, test } from "bun:test";
import {
  ACCESS_TTL_MS,
  createApiKeyStore,
  createOperatorInviteStore,
  createOperatorStore,
  createRoleStore,
  createSessionStore,
  setRoleGrants,
  upsertRole,
} from "../../auth/index.ts";
import type { Manifest } from "../../manifest/types.ts";
import type { WideEvent } from "../../runs/types.ts";
import {
  accessCreateKey,
  accessRevokeKey,
  accessSetRoleGrants,
  effectivePermissions,
  expandAccessCeiling,
  isKeyUnused90d,
  KEY_UNUSED_MS,
  keyBlastRadius,
  projectAccessPanel,
  residualAccessNote,
} from "./access.ts";
import { createDefaultGateAuthStores } from "./gates.ts";

const MANIFEST: Manifest = {
  oke: "1.0",
  app: "access-console-test",
  flows: {
    "bookings.create": {
      plane: "user",
      gates: ["member", "booking:create"],
    },
    "console.store.query": {
      plane: "operator",
      gates: [],
    },
  },
  gates: {
    member: { kind: "policy" },
    "booking:create": { kind: "policy", scopes: ["booking:create"] },
  },
};

describe("projectAccessPanel", () => {
  test("planes stay separate; grantable uses attenuation; hygiene surfaces", () => {
    const auth = createDefaultGateAuthStores();
    const operators = createOperatorStore();
    operators.operators.set("op1", {
      id: "op1",
      email: "ops@example.com",
      name: "Ops",
      status: "active",
      mfaEnabled: false,
      invitedBy: null,
      lastSeenAt: 1,
    });
    operators.roles.set("op1", ["role_ops"]);
    operators.operators.set("op_never", {
      id: "op_never",
      email: "never@example.com",
      name: "Never",
      status: "invited",
      mfaEnabled: false,
      invitedBy: null,
      lastSeenAt: null,
    });

    const invites = createOperatorInviteStore();
    const now = () => 1_700_000_000_000;
    invites.invites.set("inv1", {
      id: "inv1",
      email: "expired@example.com",
      invitedBy: "op1",
      createdAt: now() - KEY_UNUSED_MS,
      expiresAt: now() - 1,
      acceptedAt: null,
    });

    auth.apiKeys.keys.set("key_stale", {
      id: "key_stale",
      plane: "user",
      hash: "x",
      name: "Stale",
      scopes: ["member"],
      expiresAt: null,
      rateLimit: null,
      ipAllowlist: [],
      creatorId: "op1",
      creatorScopes: ["member"],
      createdAt: now() - KEY_UNUSED_MS - 1,
      lastUsedAt: null,
      revokedAt: null,
    });

    const projection = projectAccessPanel({
      manifest: MANIFEST,
      roles: auth.roles,
      apiKeys: auth.apiKeys,
      operators,
      invites,
      identities: [
        {
          id: "user_demo",
          email: "demo@example.com",
          name: "Demo",
          status: "active",
          scopes: ["member"],
        },
      ],
      roleMembers: auth.roleMembers,
      actorScopes: ["console:*"],
      accessTtlMs: ACCESS_TTL_MS,
      now,
    });

    expect(projection.operatorPlane.plane).toBe("operator");
    expect(projection.userPlane.plane).toBe("user");
    expect(projection.operatorPlane.users).toBeUndefined();
    expect(projection.userPlane.operators).toBeUndefined();

    // Cross-plane scopes absent from grantable lists.
    expect(
      projection.operatorPlane.grantableScopes.every((s) =>
        s.startsWith("console:"),
      ),
    ).toBe(true);
    expect(
      projection.userPlane.grantableScopes.every(
        (s) => !s.startsWith("console:"),
      ),
    ).toBe(true);

    expect(projection.hygiene.unusedKeys.some((k) => k.id === "key_stale")).toBe(
      true,
    );
    expect(
      projection.hygiene.neverSignedInOperators.some((o) => o.id === "op_never"),
    ).toBe(true);
    expect(
      projection.hygiene.expiredInvitations.some((i) => i.id === "inv1"),
    ).toBe(true);
  });

  test("scope not held is not grantable (absence, not refusal)", () => {
    const auth = createDefaultGateAuthStores();
    const projection = projectAccessPanel({
      manifest: MANIFEST,
      roles: auth.roles,
      apiKeys: auth.apiKeys,
      operators: createOperatorStore(),
      invites: createOperatorInviteStore(),
      identities: [],
      roleMembers: auth.roleMembers,
      // Narrow ceiling — no booking:create.
      actorScopes: ["console:store.sql:read"],
      now: () => 0,
    });
    expect(projection.userPlane.grantableScopes).not.toContain("booking:create");
    expect(projection.operatorPlane.grantableScopes).toContain(
      "console:store.sql:read",
    );
    expect(projection.operatorPlane.grantableScopes).not.toContain(
      "console:store.sql:write",
    );
  });
});

describe("effectivePermissions", () => {
  test("provenance shows which role granted which scope", () => {
    const roles = createRoleStore();
    upsertRole(roles, {
      id: "role_member",
      name: "member",
      plane: "user",
      description: "",
    });
    setRoleGrants(roles, "role_member", ["member", "booking:create"]);
    const result = effectivePermissions({
      kind: "user",
      id: "user_demo",
      roles,
      apiKeys: createApiKeyStore(),
      operators: createOperatorStore(),
      identities: [
        {
          id: "user_demo",
          email: "d@x.com",
          name: "Demo",
          status: "active",
          scopes: [],
        },
      ],
      roleMembers: new Map([["role_member", ["user_demo"]]]),
    });
    expect(result?.scopes.find((s) => s.scope === "booking:create")?.sources).toEqual([
      { kind: "role", id: "role_member", name: "member" },
    ]);
  });
});

describe("keyBlastRadius", () => {
  test("queries Runs for volume, last-used, source addresses; TTL from config", () => {
    const apiKeys = createApiKeyStore();
    apiKeys.keys.set("key_demo", {
      id: "key_demo",
      plane: "user",
      hash: "h",
      name: "Demo",
      scopes: ["member"],
      expiresAt: null,
      rateLimit: null,
      ipAllowlist: [],
      creatorId: "u",
      creatorScopes: ["member"],
      createdAt: 0,
      lastUsedAt: null,
      revokedAt: null,
    });
    const runs: WideEvent[] = [
      {
        id: "r1",
        flow: "bookings.create",
        trigger: "http",
        plane: "user",
        principal: "key_demo",
        gates: [],
        cache: "none",
        effects: [],
        logs: [],
        durationMs: 10,
        startedAt: 100,
        endedAt: 110,
        dimensions: { ip: "203.0.113.10" },
      },
      {
        id: "r2",
        flow: "bookings.create",
        trigger: "http",
        plane: "user",
        principal: "key_demo",
        gates: [],
        cache: "none",
        effects: [],
        logs: [],
        durationMs: 10,
        startedAt: 200,
        endedAt: 210,
        dimensions: { source_ip: "198.51.100.7" },
      },
    ];
    const ttl = 7 * 60 * 1000;
    const blast = keyBlastRadius({
      keyId: "key_demo",
      apiKeys,
      runs,
      accessTtlMs: ttl,
    });
    expect(blast.callVolume).toBe(2);
    expect(blast.lastUsedAt).toBe(200);
    expect(blast.sourceAddresses).toEqual(["198.51.100.7", "203.0.113.10"]);
    expect(blast.accessTtlMs).toBe(ttl);
    expect(blast.residualAccessNote).toBe(
      residualAccessNote(ttl),
    );
    expect(blast.residualAccessNote).toContain("7 minute");
  });
});

describe("accessCreateKey / revoke", () => {
  test("create attenuates; revoke is irreversible", async () => {
    const store = createApiKeyStore();
    const created = await accessCreateKey(store, {
      plane: "user",
      name: "k",
      scopes: ["member"],
      creatorId: "op1",
      creatorScopes: ["console:*"],
      catalog: ["member", "booking:create", "console:store.sql:read"],
      now: () => 1,
    });
    expect(created.secret.startsWith("oke_")).toBe(true);
    expect(created.row.scopes).toEqual(["member"]);

    await expect(
      accessCreateKey(store, {
        plane: "operator",
        name: "bad",
        scopes: ["booking:create"],
        creatorId: "op1",
        creatorScopes: ["console:*"],
        catalog: ["member", "booking:create", "console:store.sql:read"],
      }),
    ).rejects.toThrow();

    const sessions = createSessionStore();
    const revoked = accessRevokeKey({
      apiKeys: store,
      sessions,
      keyId: created.row.id,
      now: () => 2,
    });
    expect(revoked?.revokedAt).toBe(2);
  });

  test("setRoleGrants refuses scopes outside grantable", () => {
    const roles = createRoleStore();
    upsertRole(roles, {
      id: "role_ops",
      name: "ops",
      plane: "operator",
      description: "",
    });
    expect(() =>
      accessSetRoleGrants({
        roles,
        roleId: "role_ops",
        scopes: ["booking:create"],
        actorScopes: ["console:store.sql:read"],
        catalog: ["booking:create", "console:store.sql:read"],
      }),
    ).toThrow(/not grantable/);
  });
});

describe("helpers", () => {
  test("expandAccessCeiling adds application scopes for console:*", () => {
    const held = expandAccessCeiling(["console:*"], [
      "console:store.sql:read",
      "booking:create",
    ]);
    expect(held.has("console:store.sql:read")).toBe(true);
    expect(held.has("booking:create")).toBe(true);
  });

  test("isKeyUnused90d", () => {
    const now = () => 1_000_000 + KEY_UNUSED_MS;
    expect(
      isKeyUnused90d(
        { createdAt: 1_000_000, lastUsedAt: null, revokedAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      isKeyUnused90d(
        {
          createdAt: now() - 1,
          lastUsedAt: now() - 1,
          revokedAt: null,
        },
        now,
      ),
    ).toBe(false);
  });

  test("residualAccessNote uses config TTL, not a hardcoded 14", () => {
    expect(residualAccessNote(60_000)).toBe(
      "Existing access may continue up to 1 minute",
    );
    expect(residualAccessNote(90_000)).toBe(
      "Existing access may continue up to 2 minutes",
    );
  });
});
