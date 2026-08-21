/**
 * Boot-level: API-key Bearer stamps WideEvent.principal with the issuer
 * (`creatorId`) and `dimensions.api_key` with the key id.
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
  test("API key Bearer stamps WideEvent.principal with the issuer", async () => {
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
    expect(event?.principal).toBe("u1");
    expect(event?.dimensions.api_key).toBe("key_demo");
    expect(event?.dimensions.principal).toBe("u1");

    await app.stop();
  });

  test("key-authenticated request stamps fx.auth.userId as issuer and apiKeyId as the key", async () => {
    resetBindings();
    resetFlowSeq();

    on(
      http.get("/who").gate(member),
      flow("secure.who", {
        do: (_input, fx) => ({
          userId: fx.auth.userId,
          apiKeyId: fx.auth.apiKeyId ?? null,
        }),
      }),
    );

    const apiKeys = createApiKeyStore();
    const created = await createApiKey(apiKeys, {
      plane: "user",
      name: "who",
      scopes: ["member"],
      creatorId: "u1",
      creatorScopes: ["member"],
      id: "key_who",
    });
    const app = oke({
      name: "api-key-who",
      gate: {
        auth: {
          secret: "hmac-secret-for-tests",
          sessions: createSessionStore(),
          apiKeyStore: apiKeys,
          http: false,
        },
        policies: [member],
      },
      env: "test",
      startScheduler: false,
    });
    await app.boot({ env: "test", gates: [member], startScheduler: false });

    const res = await app.fetch(
      new Request("http://localhost/who", {
        method: "GET",
        headers: { authorization: `Bearer ${created.secret}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { userId: string; apiKeyId: string } };
    expect(body.data.userId).toBe("u1");
    expect(body.data.apiKeyId).toBe("key_who");

    await app.stop();
  });

  test("scope A is Forbidden on gate.scope(B) and 200 on gate.scope(A)", async () => {
    resetBindings();
    resetFlowSeq();

    const scopeA = gate.scope("scope:a");
    const scopeB = gate.scope("scope:b");
    on(http.get("/a").gate(scopeA), flow("secure.a", { do: () => ({ ok: true }) }));
    on(http.get("/b").gate(scopeB), flow("secure.b", { do: () => ({ ok: true }) }));

    const apiKeys = createApiKeyStore();
    const created = await createApiKey(apiKeys, {
      plane: "user",
      name: "scoped",
      scopes: ["scope:a"],
      creatorId: "u1",
      creatorScopes: ["scope:a", "scope:b"],
    });
    const app = oke({
      name: "api-key-scopes",
      gate: {
        auth: {
          secret: "hmac-secret-for-tests",
          sessions: createSessionStore(),
          apiKeyStore: apiKeys,
          http: false,
        },
        policies: [scopeA, scopeB],
      },
      env: "test",
      startScheduler: false,
    });
    await app.boot({ env: "test", gates: [scopeA, scopeB], startScheduler: false });

    const a = await app.fetch(
      new Request("http://localhost/a", {
        method: "GET",
        headers: { authorization: `Bearer ${created.secret}` },
      }),
    );
    const b = await app.fetch(
      new Request("http://localhost/b", {
        method: "GET",
        headers: { authorization: `Bearer ${created.secret}` },
      }),
    );
    expect(a.status).toBe(200);
    expect(b.status).toBe(403);

    await app.stop();
  });

  test("allowlist miss and over-rate → 401, no api_key dimension", async () => {
    resetBindings();
    resetFlowSeq();

    on(http.get("/secure").gate(member), flow("secure.limit", { do: () => ({ ok: true }) }));

    const apiKeys = createApiKeyStore();
    const allowlisted = await createApiKey(apiKeys, {
      plane: "user",
      name: "allow",
      scopes: ["member"],
      creatorId: "u1",
      creatorScopes: ["member"],
      id: "key_allow",
      ipAllowlist: ["203.0.113.10"],
    });
    const rated = await createApiKey(apiKeys, {
      plane: "user",
      name: "rated",
      scopes: ["member"],
      creatorId: "u1",
      creatorScopes: ["member"],
      id: "key_rate",
      rateLimit: { max: 1, per: "1m" },
    });
    const runs = createRunsRuntime({ driver: memoryRunsDriver });
    await runs.open();
    const app = oke({
      name: "api-key-limits",
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

    const miss = await app.fetch(
      new Request("http://localhost/secure", {
        method: "GET",
        headers: {
          authorization: `Bearer ${allowlisted.secret}`,
          "x-forwarded-for": "198.51.100.7",
        },
      }),
    );
    expect(miss.status).toBe(401);

    const first = await app.fetch(
      new Request("http://localhost/secure", {
        method: "GET",
        headers: { authorization: `Bearer ${rated.secret}` },
      }),
    );
    const second = await app.fetch(
      new Request("http://localhost/secure", {
        method: "GET",
        headers: { authorization: `Bearer ${rated.secret}` },
      }),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(401);

    const events = await runs.all();
    for (const event of events) {
      if (event.dimensions.error_code) {
        expect(event.dimensions.api_key).toBeUndefined();
      }
    }

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

  test("operator-plane key stamps fx.operator.id as the issuer", async () => {
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
    expect(body.data.operatorId).toBe("op1");

    const event = await lastEvent(runs);
    expect(event?.principal).toBe("op1");
    expect(event?.plane).toBe("operator");
    expect(event?.dimensions.api_key).toBe("key_ops");

    await app.stop();
  });
});
