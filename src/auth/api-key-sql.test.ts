import { describe, expect, test } from "bun:test";
import { createApiKey, createApiKeyStore } from "./api-keys.ts";
import { bindApiKeySqlPersist, hydrateApiKeyStore, type ApiKeySqlExec } from "./api-key-sql.ts";

describe("api-key SQL persist", () => {
  test("hydrate + persist round-trip", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const sql: ApiKeySqlExec = {
      async execute(_q, params) {
        const id = String(params[0]);
        rows.set(id, {
          id,
          plane: params[1],
          hash: params[2],
          name: params[3],
          scopes: params[4],
          expires_at: params[5],
          rate_limit: params[6],
          ip_allowlist: params[7],
          creator_id: params[8],
          creator_scopes: params[9],
          created_at: params[10],
          last_used_at: params[11],
          revoked_at: params[12],
        });
      },
      async all() {
        return [...rows.values()];
      },
    };
    const store = createApiKeyStore();
    bindApiKeySqlPersist(store, sql);
    const created = await createApiKey(store, {
      plane: "user",
      name: "sql",
      scopes: ["member"],
      creatorId: "u1",
      creatorScopes: ["member"],
      id: "key_sql",
    });
    const other = createApiKeyStore();
    await hydrateApiKeyStore(sql, other);
    expect(other.keys.get("key_sql")?.name).toBe("sql");
    expect(other.keys.get("key_sql")?.creatorId).toBe("u1");
    expect(other.keys.get("key_sql")?.hash).toBe(created.row.hash);
  });
});
