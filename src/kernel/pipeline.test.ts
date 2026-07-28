/**
 * Pipeline acceptance:
 * - `.gate(member)` → typed Unauthorized for anonymous callers
 * - RateLimited / Forbidden typed denials (never thrown)
 * - evaluated gate chain lands on the run (not only declared names)
 * - forged / expired Bearer → Unauthorized (cryptographic verifyAccess)
 * - extras.principal injection gated to test env only
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  createSessionStore,
  issueSessionWithScopes,
} from "../auth/sessions.ts";
import { createClockRuntime } from "../elements/clock.ts";
import { gate } from "../elements/gate.ts";
import { createRunsRuntime, memoryRunsDriver } from "../runs/index.ts";
import { oke } from "./app.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { http } from "./triggers.ts";
import {
  gateDenialFailure,
  recordGateEvaluations,
} from "./pipeline.ts";
import { createRunTelemetry } from "./run-telemetry.ts";

const member = gate.policy("member", ({ auth }) => !!auth.verified);
const canOrder = gate.policy("order:create", ({ auth }) =>
  auth.scopes.has("order:create"),
);

describe("gateDenialFailure", () => {
  test("anonymous → Unauthorized; authed → Forbidden; rate → RateLimited", () => {
    const anon = gateDenialFailure(
      { name: "member", kind: "policy", allowed: false, reason: "policy denied" },
      {
        auth: { userId: null, scopes: new Set() },
        operator: { id: null },
      },
    );
    expect(anon.error.code).toBe("Unauthorized");

    const forbid = gateDenialFailure(
      { name: "order:create", kind: "policy", allowed: false },
      {
        auth: { userId: "u1", scopes: new Set(), verified: true },
        operator: { id: null },
      },
    );
    expect(forbid.error.code).toBe("Forbidden");

    const rate = gateDenialFailure(
      {
        name: "rate:x",
        kind: "rate",
        allowed: false,
        retryAfterMs: 1500,
        reason: "rate limited",
      },
      {
        auth: { userId: "u1", scopes: new Set(), verified: true },
        operator: { id: null },
      },
    );
    expect(rate.error.code).toBe("RateLimited");
    expect(rate.error.data).toEqual({ retryAfterMs: 1500 });
  });
});

describe("pipeline — Unauthorized for anonymous", () => {
  test("flow with .gate(member) returns typed Unauthorized", async () => {
    resetBindings();
    resetFlowSeq();

    on(
      http.post("/orders").gate(member),
      flow({
        name: "orders.create",
        in: z.object({ sku: z.string() }),
        out: z.object({ id: z.string() }),
        do: (_input, fx) => ({ id: fx.id() }),
      }),
    );

    const runs = createRunsRuntime({ driver: memoryRunsDriver });
    const app = oke({
      name: "gates-pipeline",
      gates: [member],
      runs,
      env: "test",
    });
    await app.boot({ env: "test", gates: [member], runs });

    const res = await app.fetch(
      new Request("http://localhost/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sku: "COFFEE" }),
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      data: null;
      error: { code: string };
    };
    expect(body.error.code).toBe("Unauthorized");
    await app.bootResult?.close();
  });

  test("authenticated member passes; missing scope → Forbidden", async () => {
    resetBindings();
    resetFlowSeq();

    on(
      http.post("/orders").gate(member, canOrder),
      flow({
        name: "orders.create2",
        in: z.object({ sku: z.string() }),
        do: () => ({ ok: true }),
      }),
    );

    const app = oke({
      name: "gates-forbid",
      gates: [member, canOrder],
      env: "test",
    });
    await app.boot({ env: "test", gates: [member, canOrder] });

    const res = await app.execute(
      app.flow("orders.create2")!,
      { sku: "X" },
      http.post("/orders").gate(member, canOrder),
      {
        principal: {
          plane: "user",
          userId: "u1",
          scopes: new Set(), // no order:create
          verified: true,
        },
      },
    );
    expect(res.failure?.error.code).toBe("Forbidden");
    await app.bootResult?.close();
  });
});

describe("pipeline — evaluated gates on the run", () => {
  test("recorded run contains evaluated chain, not just declared names", async () => {
    resetBindings();
    resetFlowSeq();

    on(
      http.post("/orders").gate(member, canOrder),
      flow({
        name: "orders.create3",
        in: z.object({ sku: z.string() }),
        do: () => ({ ok: true }),
      }),
    );

    const runs = createRunsRuntime({ driver: memoryRunsDriver });
    await runs.open();
    const app = oke({
      name: "gates-eval",
      gates: [member, canOrder],
      runs,
      env: "test",
    });
    await app.boot({ env: "test", gates: [member, canOrder], runs });

    // Anonymous — stops at member; canOrder never evaluated.
    await app.execute(
      app.flow("orders.create3")!,
      { sku: "X" },
      http.post("/orders").gate(member, canOrder),
    );

    const events = await runs.all();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1]!;
    expect(last.gates).toEqual(["member"]);
    expect(last.gates).not.toContain("order:create");
    expect(last.dimensions["gate:member"]).toBe("deny");

    await app.bootResult?.close();
  });

  test("recordGateEvaluations appends pass and deny", () => {
    const telemetry = createRunTelemetry();
    recordGateEvaluations(telemetry, [
      { name: "member", kind: "policy", allowed: true },
      { name: "order:create", kind: "policy", allowed: false },
    ]);
    expect(telemetry.gates).toEqual(["member", "order:create"]);
    expect(telemetry.dimensions["gate:member"]).toBe("pass");
    expect(telemetry.dimensions["gate:order:create"]).toBe("deny");
  });
});

describe("pipeline — Bearer cryptographic verification", () => {
  test("forged Bearer token → Unauthorized (not a principal)", async () => {
    resetBindings();
    resetFlowSeq();

    on(
      http.get("/secure").gate(member),
      flow({
        name: "secure.get",
        do: () => ({ ok: true }),
      }),
    );

    const sessions = createSessionStore();
    const app = oke({
      name: "auth-forge",
      gates: [member],
      env: "local",
      auth: { secret: "hmac-secret-for-tests", sessions },
      startScheduler: false,
    });
    await app.boot({ env: "local", gates: [member], startScheduler: false });

    const res = await app.fetch(
      new Request("http://localhost/secure", {
        method: "GET",
        headers: {
          authorization:
            "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrZXIifQ.forgedsignature",
        },
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("Unauthorized");

    await app.stop();
  });

  test("expired Bearer token → Unauthorized", async () => {
    resetBindings();
    resetFlowSeq();

    on(
      http.get("/secure").gate(member),
      flow({
        name: "secure.get2",
        do: () => ({ ok: true }),
      }),
    );

    let nowMs = 1_000_000;
    const sessions = createSessionStore();
    const secret = "hmac-secret-for-tests";
    const issued = await issueSessionWithScopes(
      sessions,
      { secret, now: () => nowMs, accessTtlMs: 60_000 },
      {
        id: "user-1",
        plane: "user",
        scopes: ["order:create"],
      },
    );

    // Shared clock so boot's auth rebinding still reads `nowMs`.
    const clockRt = createClockRuntime({
      now: () => nowMs,
      instanceId: "auth-expired",
    });
    const app = oke({
      name: "auth-expired",
      gates: [member],
      env: "local",
      auth: { secret, sessions, now: () => nowMs },
      elements: { clock: clockRt },
      startScheduler: false,
    });
    await app.boot({
      env: "local",
      gates: [member],
      startScheduler: false,
      elements: { clock: clockRt },
    });

    // Still valid at issue time.
    const okRes = await app.fetch(
      new Request("http://localhost/secure", {
        method: "GET",
        headers: { authorization: `Bearer ${issued.accessToken}` },
      }),
    );
    expect(okRes.status).toBe(200);

    // Advance past access TTL — same token must fail.
    nowMs += 120_000;
    const expiredRes = await app.fetch(
      new Request("http://localhost/secure", {
        method: "GET",
        headers: { authorization: `Bearer ${issued.accessToken}` },
      }),
    );
    expect(expiredRes.status).toBe(401);
    const body = (await expiredRes.json()) as { error: { code: string } };
    expect(body.error.code).toBe("Unauthorized");

    await app.stop();
  });

  test("extras.principal injection is ignored outside test env", async () => {
    resetBindings();
    resetFlowSeq();

    on(
      http.post("/orders").gate(member),
      flow({
        name: "orders.inject",
        in: z.object({ sku: z.string() }),
        do: () => ({ ok: true }),
      }),
    );

    const app = oke({
      name: "no-inject",
      gates: [member],
      env: "local",
      startScheduler: false,
    });
    await app.boot({ env: "local", gates: [member], startScheduler: false });

    const result = await app.execute(
      app.flow("orders.inject")!,
      { sku: "X" },
      http.post("/orders").gate(member),
      {
        principal: {
          plane: "user",
          userId: "attacker",
          scopes: new Set(["*"]),
          verified: true,
        },
      },
    );
    expect(result.failure?.error.code).toBe("Unauthorized");

    await app.stop();
  });
});
