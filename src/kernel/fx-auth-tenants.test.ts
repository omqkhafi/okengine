/**
 * Session-only tenant methods — switchTenant mints a new family; listTenants refuses keys.
 */

import { describe, expect, test } from "bun:test";
import { createSessionStore, issueSession, verifyAccess } from "../auth/sessions.ts";
import { createTenant, createTenantStore } from "../auth/tenants.ts";
import { isFlowFailure } from "./hooks.ts";
import { createFx } from "./fx.ts";

const SECRET = "tenant-methods-test-secret";

describe("fx.auth tenant methods", () => {
  test("listTenants is session-only", async () => {
    const store = createTenantStore();
    await createTenant(store, { name: "Acme", createdBy: "u1", id: "t1" });
    const asKey = createFx({
      flow: "tenants.list",
      effects: { reads: ["auth:tenants"] },
      tenantStore: store,
      tenantEnabled: true,
      auth: { userId: "u1", scopes: new Set(), apiKeyId: "key_1" },
    });
    try {
      await asKey.auth.listTenants();
      throw new Error("expected Forbidden");
    } catch (err) {
      expect(isFlowFailure(err)).toBe(true);
      if (isFlowFailure(err)) {
        expect(err.error.code).toBe("Forbidden");
        expect(err.error.data).toEqual({ gate: "auth:tenants", reason: "session_only" });
      }
    }

    const asSession = createFx({
      flow: "tenants.list.session",
      effects: { reads: ["auth:tenants"] },
      tenantStore: store,
      tenantEnabled: true,
      auth: { userId: "u1", scopes: new Set(), apiKeyId: null },
    });
    const listed = await asSession.auth.listTenants();
    expect(listed.map((t) => t.id)).toEqual(["t1"]);
  });

  test("switchTenant issues a new family and copies tid without melting tenant scopes", async () => {
    const tenantStore = createTenantStore();
    await createTenant(tenantStore, { name: "Acme", createdBy: "u1", id: "t1" });
    await createTenant(tenantStore, { name: "Globex", createdBy: "u1", id: "t2" });
    const sessions = createSessionStore();
    const crypto = { secret: SECRET };
    const first = await issueSession(sessions, crypto, {
      id: "u1",
      plane: "user",
      scopes: ["member"],
      tenantId: "t1",
    });

    const liveScopes = new Set(["member", "booking:create"]);
    const fx = createFx({
      flow: "tenants.switch",
      effects: { writes: ["auth:tenants"] },
      tenantStore,
      tenantEnabled: true,
      sessions,
      sessionCrypto: crypto,
      auth: {
        userId: "u1",
        scopes: liveScopes,
        sessionScopes: new Set(["member"]),
        apiKeyId: null,
      },
    });
    const switched = await fx.auth.switchTenant("t2");
    expect(switched.session.familyId).not.toBe(first.session.familyId);
    expect(switched.session.id).not.toBe(first.session.id);

    const claims = await verifyAccess(sessions, SECRET, switched.accessToken);
    expect(claims.tid).toBe("t2");
    expect(claims.scopes).toEqual(["member"]);
    expect(claims.sid).toBe(switched.session.id);

    const firstStill = await verifyAccess(sessions, SECRET, first.accessToken);
    expect(firstStill.tid).toBe("t1");
    expect(firstStill.sid).toBe(first.session.id);
  });
});
