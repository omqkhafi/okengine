/**
 * Boot-level: API-key Bearer stamps WideEvent.principal with the key id.
 * Session JWT stamps the session subject — never a key id.
 */

import { describe, expect, test } from "bun:test";
import { createApiKey, createApiKeyStore, revokeApiKey } from "../auth/api-keys.ts";
import { createSessionStore, issueSessionWithScopes } from "../auth/sessions.ts";
import { gate } from "../elements/gate.ts";
import { createRunsRuntime, memoryRunsDriver } from "../runs/index.ts";
import { oke } from "./app.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { http } from "./triggers.ts";

const member = gate.policy("member", ({ auth }) => !!auth.verified);
const operatorPresent = gate.policy("operator", ({ operator }) => operator.id !== null);

async function lastEvent(runs: ReturnType<typeof createRunsRuntime>) {
  const events = await runs.all();
  return events[events.length - 1];
}

describe("pipeline — API key Bearer identity", () => {
  test("API key Bearer stamps WideEvent.principal with the key id", async () => {
    resetBindings();
    resetFlowSeq();

    on(
      http.get("/secure").gate(member),
      flow("secure.key", {
        do: () => ({ ok: true }),
      }),
    );

    const apiKeys = createApiKeyStore();
    const created = await createApiKey(apiKeys, {
      plane: "user",
      name: "demo",
      scopes: ["member"],
      creatorId: "u1",
      creatorScopes: ["member"],
      id: "key_demo",
    });
    const runs = createRunsRuntime({ driver: memoryRunsDriver });
    await runs.open();
    const app = oke({
      name: "api-key-principal",
      gate: {
        auth: {
          secret: "hmac-secret-for-tests",
          sessions: createSessionStore(),
          apiKeyStore: apiKeys,
          http: false,
        },
        policies: [member],
      },
      runs,
      env: "test",
      startScheduler: false,
    });
    await app.boot({ env: "test", gates: [member], runs, startScheduler: false });

    const res = await app.fetch(
      new Request("http://localhost/secure", {
        method: "GET",
        headers: { authorization: `Bearer ${created.secret}` },
      }),
    );
    expect(res.status).toBe(200);

    const event = await lastEvent(runs);
    expect(event?.principal).toBe("key_demo");
    expect(event?.dimensions.api_key).toBe("key_demo");
    expect(event?.dimensions.principal).toBe("key_demo");

    await app.stop();
  });

  test("session JWT stamps claims.sub — not a key id", async () => {
    resetBindings();
    resetFlowSeq();

    on(
      http.get("/secure").gate(member),
      flow("secure.session", {
        do: () => ({ ok: true }),
      }),
    );

    const sessions = createSessionStore();
    const secret = "hmac-secret-for-tests";
    const issued = await issueSessionWithScopes(
      sessions,
      { secret, now: () => 1_000_000, accessTtlMs: 60_000 },
      { id: "user_42", plane: "user", scopes: ["member"] },
    );
    const apiKeys = createApiKeyStore();
    await createApiKey(apiKeys, {
      plane: "user",
      name: "unused",
      scopes: ["member"],
      creatorId: "u1",
      creatorScopes: ["member"],
      id: "key_unused",
    });
    const runs = createRunsRuntime({ driver: memoryRunsDriver });
    await runs.open();
    const app = oke({
      name: "session-principal",
      gate: {
        auth: { secret, sessions, apiKeyStore: apiKeys, now: () => 1_000_000, http: false },
        policies: [member],
      },
      runs,
      env: "test",
      startScheduler: false,
    });
    await app.boot({ env: "test", gates: [member], runs, startScheduler: false });

    const res = await app.fetch(
      new Request("http://localhost/secure", {
        method: "GET",
        headers: { authorization: `Bearer ${issued.accessToken}` },
      }),
    );
    expect(res.status).toBe(200);

    const event = await lastEvent(runs);
    expect(event?.principal).toBe("user_42");
    expect(event?.dimensions.api_key).toBeUndefined();

    await app.stop();
  });

  test("forged / revoked / expired key → Unauthorized, no principal", async () => {
    resetBindings();
    resetFlowSeq();

    on(
      http.get("/secure").gate(member),
      flow("secure.deny", {
        do: () => ({ ok: true }),
      }),
    );

    const apiKeys = createApiKeyStore();
    const revoked = await createApiKey(apiKeys, {
      plane: "user",
      name: "revoked",
      scopes: ["member"],
      creatorId: "u1",
      creatorScopes: ["member"],
      id: "key_revoked",
    });
    revokeApiKey(apiKeys, revoked.row.id, () => 2_000);

    const expired = await createApiKey(apiKeys, {
      plane: "user",
      name: "expired",
      scopes: ["member"],
      creatorId: "u1",
      creatorScopes: ["member"],
      id: "key_expired",
      expiresAt: 500,
      now: () => 1,
    });

    const runs = createRunsRuntime({ driver: memoryRunsDriver });
    await runs.open();
    const app = oke({
      name: "api-key-deny",
      gate: {
        auth: {
          secret: "hmac-secret-for-tests",
          sessions: createSessionStore(),
          apiKeyStore: apiKeys,
          now: () => 1_000,
          http: false,
        },
        policies: [member],
      },
      runs,
      env: "test",
      startScheduler: false,
    });
    await app.boot({ env: "test", gates: [member], runs, startScheduler: false });

    for (const token of ["oke_forged_not_a_key", revoked.secret, expired.secret]) {
      const res = await app.fetch(
        new Request("http://localhost/secure", {
          method: "GET",
          headers: { authorization: `Bearer ${token}` },
        }),
      );
      expect(res.status).toBe(401);
    }

    const events = await runs.all();
    for (const event of events) {
      expect(event.principal).not.toBe("key_revoked");
      expect(event.principal).not.toBe("key_expired");
      expect(event.dimensions.api_key).toBeUndefined();
    }

    await app.stop();
  });

  test("operator-plane key stamps fx.operator.id as the key id", async () => {
    resetBindings();
    resetFlowSeq();

    on(
      http.get("/op").gate(operatorPresent),
      flow("secure.operator", {
        plane: "operator",
        do: (_input, fx) => ({ operatorId: fx.operator.id }),
      }),
    );

    const apiKeys = createApiKeyStore();
    const created = await createApiKey(apiKeys, {
      plane: "operator",
      name: "ops",
      scopes: ["console:*"],
      creatorId: "op1",
      creatorScopes: ["console:*"],
      id: "key_ops",
    });
    const runs = createRunsRuntime({ driver: memoryRunsDriver });
    await runs.open();
    const app = oke({
      name: "api-key-operator",
      gate: {
        auth: {
          secret: "hmac-secret-for-tests",
          sessions: createSessionStore(),
          apiKeyStore: apiKeys,
          http: false,
        },
        policies: [operatorPresent],
      },
      runs,
      env: "test",
      startScheduler: false,
    });
    await app.boot({ env: "test", gates: [operatorPresent], runs, startScheduler: false });

    const res = await app.fetch(
      new Request("http://localhost/op", {
        method: "GET",
        headers: { authorization: `Bearer ${created.secret}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { operatorId: string } };
    expect(body.data.operatorId).toBe("key_ops");

    const event = await lastEvent(runs);
    expect(event?.principal).toBe("key_ops");
    expect(event?.plane).toBe("operator");
    expect(event?.dimensions.api_key).toBe("key_ops");

    await app.stop();
  });
});
