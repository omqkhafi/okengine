/**
 * Console Gates projection + evaluate-only simulator (console §9.7).
 */

import { describe, expect, test } from "bun:test";
import {
  createApiKeyStore,
  createRoleStore,
  setRoleGrants,
  upsertRole,
} from "../../auth/index.ts";
import { memoryKvDriver } from "../../drivers/memory.ts";
import {
  createGateRuntime,
  gate,
  type GateRuntime,
} from "../../elements/gate.ts";
import type { Manifest } from "../../manifest/types.ts";
import {
  createDefaultGateAuthStores,
  isApplicationScope,
  projectGatesPanel,
  simulateGates,
} from "./gates.ts";

const MANIFEST: Manifest = {
  oke: "1.0",
  app: "gates-console-test",
  flows: {
    "bookings.create": {
      plane: "user",
      gates: ["member", "booking:create", "rate:sliding-window-counter:2/1m"],
    },
    "reports.export": {
      plane: "user",
      gates: ["staff"],
    },
    "health.ping": {
      plane: "user",
      gates: [],
    },
    "console.store.query": {
      plane: "operator",
      gates: [],
    },
  },
  gates: {
    member: { kind: "policy" },
    "booking:create": { kind: "policy", scopes: ["booking:create"] },
    staff: { kind: "policy", roles: ["staff"] },
    "rate:sliding-window-counter:2/1m": {
      kind: "rate",
      strategy: "sliding-window-counter",
      max: 2,
      per: "1m",
      keyBy: "user",
    },
    unusedGate: { kind: "policy" },
  },
};

async function liveRuntime(): Promise<{
  runtime: GateRuntime;
  close: () => Promise<void>;
}> {
  const kv = await memoryKvDriver.open({ name: "gates-test-live" });
  const member = gate.policy("member", ({ auth }) => Boolean(auth.verified));
  const canBook = gate.policy("booking:create", ({ auth }) =>
    auth.scopes.has("booking:create"),
  );
  const staff = gate.policy("staff", ({ auth }) => auth.scopes.has("staff"));
  const fair = gate.rate({
    strategy: "sliding-window-counter",
    max: 2,
    per: "1m",
    keyBy: "user",
  });
  // fair.name is rate:sliding-window-counter:2/1m — matches Manifest.
  return {
    runtime: createGateRuntime({
      gates: [member, canBook, staff, fair],
      kv,
      now: () => 5_000,
    }),
    close: async () => {
      await kv.close();
    },
  };
}

describe("isApplicationScope", () => {
  test("console:* is not application; everything else is", () => {
    expect(isApplicationScope("console:store.sql:write")).toBe(false);
    expect(isApplicationScope("booking:create")).toBe(true);
    expect(isApplicationScope("member")).toBe(true);
  });
});

describe("projectGatesPanel", () => {
  test("two inquiry surfaces + continuous audit + plane violations", () => {
    const auth = createDefaultGateAuthStores();
    // Poison an operator role with an application scope.
    setRoleGrants(auth.roles, "role_ops", [
      "console:store.sql:read",
      "booking:create",
    ]);

    const projection = projectGatesPanel({
      manifest: MANIFEST,
      roles: auth.roles,
      apiKeys: auth.apiKeys,
      identities: [
        {
          id: "user_demo",
          email: "demo@example.com",
          name: "Demo",
          status: "active",
          scopes: ["member", "booking:create"],
        },
      ],
      operatorRoles: new Map([["op_1", ["role_ops"]]]),
      operators: new Map([
        ["op_1", { name: "Ops", email: "ops@example.com" }],
      ]),
      roleMembers: auth.roleMembers,
    });

    expect(projection.moduleActions).toContain("bookings:create");
    expect(projection.moduleActions).toContain("booking:create");

    const unguarded = projection.flows.find((f) => f.flowId === "health.ping");
    expect(unguarded?.unguarded).toBe(true);
    expect(projection.audit.unguardedFlows).toContain("health.ping");

    expect(projection.audit.unattachedGates).toContain("unusedGate");
    expect(projection.audit.emptyRoles).toContain("role_staff");

    // Operator with application scope is a violation, never a principal row.
    expect(
      projection.violations.some((v) =>
        v.applicationScopes.includes("booking:create"),
      ),
    ).toBe(true);
    expect(
      projection.principals.some(
        (p) => p.kind === "role" && p.id === "role_ops",
      ),
    ).toBe(false);

    // Clean user principals remain rows.
    expect(projection.principals.some((p) => p.kind === "user")).toBe(true);
    expect(projection.principals.some((p) => p.kind === "key")).toBe(true);
  });

  test("permissions granted to no role surface as orphan permissions", () => {
    const roles = createRoleStore();
    upsertRole(roles, {
      id: "r1",
      name: "only-member",
      plane: "user",
      description: "",
    });
    setRoleGrants(roles, "r1", ["member"]);
    const projection = projectGatesPanel({
      manifest: MANIFEST,
      roles,
      apiKeys: createApiKeyStore(),
      identities: [],
      operatorRoles: new Map(),
      operators: new Map(),
      roleMembers: new Map([["r1", ["u1"]]]),
    });
    expect(projection.audit.orphanPermissions).toContain("booking:create");
    expect(projection.audit.orphanPermissions).not.toContain("member");
  });
});

describe("simulateGates — evaluate only", () => {
  test("stops at first denial with Forbidden and never needs a handler", async () => {
    const { runtime, close } = await liveRuntime();
    const auth = createDefaultGateAuthStores();
    try {
      const denied = await simulateGates({
        flowId: "bookings.create",
        principal: { kind: "user", id: "user_no_scopes" },
        manifest: MANIFEST,
        gateRuntime: runtime,
        roles: auth.roles,
        apiKeys: auth.apiKeys,
        identities: [
          {
            id: "user_no_scopes",
            email: "x@example.com",
            name: "X",
            status: "active",
            scopes: [],
          },
        ],
        now: () => 5_000,
      });
      expect(denied.allowed).toBe(false);
      // member passes (verified); first denial is booking:create — chain stops.
      expect(denied.deniedAt).toBe("booking:create");
      expect(denied.evaluations.map((e) => e.name)).toEqual([
        "member",
        "booking:create",
      ]);
      expect(denied.denial?.code).toBe("Forbidden");
      expect(denied.denial?.status).toBe(403);
      expect(denied.denial?.data).toMatchObject({ gate: "booking:create" });
    } finally {
      await close();
    }
  });

  test("registration order preserved; ephemeral KV leaves live counters untouched", async () => {
    const { runtime, close } = await liveRuntime();
    const auth = createDefaultGateAuthStores();
    const identities = [
      {
        id: "user_demo",
        email: "demo@example.com",
        name: "Demo",
        status: "active" as const,
        scopes: ["member", "booking:create"],
      },
    ];
    const ctx = {
      auth: {
        userId: "user_demo",
        scopes: new Set(["member", "booking:create"]),
        verified: true,
      },
      operator: { id: null as string | null },
      meta: { userId: "user_demo" },
    };
    try {
      await runtime.check(
        ["member", "booking:create", "rate:sliding-window-counter:2/1m"],
        ctx,
      );
      await runtime.check(
        ["member", "booking:create", "rate:sliding-window-counter:2/1m"],
        ctx,
      );
      const liveDenied = await runtime.check(
        ["rate:sliding-window-counter:2/1m"],
        ctx,
      );
      expect(liveDenied[0]?.allowed).toBe(false);

      // Simulate clones decls onto ephemeral KV — does not consume live budget.
      const sim = await simulateGates({
        flowId: "bookings.create",
        principal: { kind: "user", id: "user_demo" },
        manifest: MANIFEST,
        gateRuntime: runtime,
        roles: auth.roles,
        apiKeys: auth.apiKeys,
        identities,
        now: () => 5_000,
      });
      expect(sim.allowed).toBe(true);
      expect(sim.evaluations.map((e) => e.name)).toEqual([
        "member",
        "booking:create",
        "rate:sliding-window-counter:2/1m",
      ]);
      expect(sim.denial).toBeNull();
    } finally {
      await close();
    }
  });

  test("RateLimited { retryAfterMs } is the typed client error", async () => {
    const { gateDenialFailure } = await import("../../kernel/pipeline.ts");
    const { statusForFailure } = await import("../../compiler/response.ts");
    const failure = gateDenialFailure(
      {
        name: "rate:sliding-window-counter:1/1m",
        allowed: false,
        kind: "rate",
        retryAfterMs: 42_000,
        reason: "rate limited",
      },
      {
        auth: { userId: "u", scopes: new Set(["member"]), verified: true },
        operator: { id: null },
      },
    );
    expect(failure.error.code).toBe("RateLimited");
    expect(failure.error.data).toEqual({ retryAfterMs: 42_000 });
    expect(statusForFailure(failure)).toBe(429);

    // Real strategy on ephemeral KV produces the same denial shape.
    const kv = await memoryKvDriver.open({ name: "gates-rate-shape" });
    const fair = gate.rate({ max: 1, per: "1m", keyBy: "user" });
    const member = gate.policy("member", ({ auth }) => Boolean(auth.verified));
    const rt = createGateRuntime({
      gates: [member, fair],
      kv,
      now: () => 10_000,
    });
    const ctx = {
      auth: {
        userId: "u",
        scopes: new Set(["member"]),
        verified: true,
      },
      operator: { id: null as string | null },
      meta: { userId: "u" },
    };
    await rt.check(["member", fair.name], ctx);
    const second = await rt.check(["member", fair.name], ctx);
    const denied = second.find((e) => !e.allowed);
    expect(denied?.kind).toBe("rate");
    const mapped = gateDenialFailure(denied!, {
      auth: ctx.auth,
      operator: ctx.operator,
    });
    expect(mapped.error.code).toBe("RateLimited");
    expect(
      (mapped.error.data as { retryAfterMs: number }).retryAfterMs,
    ).toBeGreaterThan(0);
    await kv.close();
  });

  test("role principal resolves scopes from RoleStore", async () => {
    const { runtime, close } = await liveRuntime();
    const auth = createDefaultGateAuthStores();
    try {
      const ok = await simulateGates({
        flowId: "bookings.create",
        principal: { kind: "role", id: "role_member" },
        manifest: MANIFEST,
        gateRuntime: runtime,
        roles: auth.roles,
        apiKeys: auth.apiKeys,
        identities: [],
        now: () => 5_000,
      });
      expect(ok.allowed).toBe(true);

      const denied = await simulateGates({
        flowId: "reports.export",
        principal: { kind: "role", id: "role_member" },
        manifest: MANIFEST,
        gateRuntime: runtime,
        roles: auth.roles,
        apiKeys: auth.apiKeys,
        identities: [],
        now: () => 5_000,
      });
      expect(denied.allowed).toBe(false);
      expect(denied.denial?.code).toBe("Forbidden");
    } finally {
      await close();
    }
  });
});
