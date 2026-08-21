/**
 * Session-only `fx.auth` key methods — issuer derived, never from flow input.
 */

import { describe, expect, test } from "bun:test";
import { AttenuationError } from "../auth/attenuation.ts";
import { createApiKey, createApiKeyStore } from "../auth/api-keys.ts";
import { isFlowFailure } from "./hooks.ts";
import { createFx } from "./fx.ts";

describe("fx.auth key methods", () => {
  test("createApiKey derives creator from the live session and rejects broader scopes", async () => {
    const store = createApiKeyStore();
    const fx = createFx({
      flow: "keys.create",
      effects: { writes: ["auth:api-keys"] },
      apiKeyStore: store,
      auth: { userId: "u1", scopes: new Set(["member"]), apiKeyId: null },
    });
    const created = await fx.auth.createApiKey({ name: "mine", scopes: ["member"] });
    expect(created.key.scopes).toEqual(["member"]);
    expect(created.secret.startsWith("oke_")).toBe(true);
    expect(store.keys.get(created.key.id)?.creatorId).toBe("u1");

    await expect(fx.auth.createApiKey({ name: "wide", scopes: ["admin"] })).rejects.toBeInstanceOf(
      AttenuationError,
    );
  });

  test("key-authenticated caller cannot create / list / revoke / rotate / update", async () => {
    const store = createApiKeyStore();
    await createApiKey(store, {
      plane: "user",
      name: "existing",
      scopes: ["member"],
      creatorId: "u1",
      creatorScopes: ["member"],
      id: "key_existing",
    });
    const fx = createFx({
      flow: "keys.as-key",
      effects: { reads: ["auth:api-keys"], writes: ["auth:api-keys"] },
      apiKeyStore: store,
      auth: { userId: "u1", scopes: new Set(["member"]), apiKeyId: "key_existing" },
    });
    for (const call of [
      () => fx.auth.createApiKey({ name: "nested", scopes: ["member"] }),
      () => fx.auth.listApiKeys(),
      () => fx.auth.revokeApiKey("key_existing"),
      () => fx.auth.rotateApiKey("key_existing"),
      () => fx.auth.updateApiKey("key_existing", { name: "nope" }),
    ]) {
      try {
        await call();
        throw new Error("expected Forbidden");
      } catch (err) {
        expect(isFlowFailure(err)).toBe(true);
        if (isFlowFailure(err)) expect(err.error.code).toBe("Forbidden");
      }
    }
  });

  test("list is self-only; cross-user revoke is Forbidden", async () => {
    const store = createApiKeyStore();
    await createApiKey(store, {
      plane: "user",
      name: "theirs",
      scopes: ["member"],
      creatorId: "u2",
      creatorScopes: ["member"],
      id: "key_theirs",
    });
    const fx = createFx({
      flow: "keys.list",
      effects: { reads: ["auth:api-keys"], writes: ["auth:api-keys"] },
      apiKeyStore: store,
      auth: { userId: "u1", scopes: new Set(["member"]), apiKeyId: null },
    });
    expect(await fx.auth.listApiKeys()).toEqual([]);
    try {
      await fx.auth.revokeApiKey("key_theirs");
      throw new Error("expected Forbidden");
    } catch (err) {
      expect(isFlowFailure(err)).toBe(true);
      if (isFlowFailure(err)) expect(err.error.code).toBe("Forbidden");
    }
  });
});
