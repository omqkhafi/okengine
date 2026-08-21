/**
 * Host API-key durability — standalone `oke()` (no Console).
 *
 * Creates a key via `fx.auth.createApiKey`, stops, boots a fresh app against
 * the same SQL URL, and verifies Bearer on the new `gate.auth.apiKeyStore`.
 * Production uses postgres + `DATABASE_URL`; this suite uses file-backed
 * PGlite at that same URL so the restart is hermetic.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUTH_TABLES } from "../auth/tables.ts";
import { gate } from "../elements/gate.ts";
import { resetStores, store } from "../elements/store/declare.ts";
import { oke } from "./app.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { http } from "./triggers.ts";

const PEPPER = "oke-host-api-key-persist-pepper";
const member = gate.policy("member", ({ auth }) => !!auth.verified);

function resetIsolated(): void {
  resetBindings();
  resetFlowSeq();
  resetStores();
}

afterEach(() => {
  resetIsolated();
});

describe("host API key persist via store.sql()", () => {
  test("standalone oke() persists keys across restart; Bearer verifies on a fresh store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-host-keys-"));
    const sqlUrl = join(dir, "pgdata");
    const prevDb = process.env.DATABASE_URL;
    const prevPglite = process.env.OKE_PGLITE_URL;
    process.env.DATABASE_URL = sqlUrl;
    process.env.OKE_PGLITE_URL = sqlUrl;

    try {
      resetIsolated();
      const db1 = store.sql("app", { schema: {} });
      on(
        http.post("/keys").gate(member),
        flow("keys.create", {
          effects: { writes: ["auth:api-keys"] },
          do: (_input, fx) => fx.auth.createApiKey({ name: "prod-ci", scopes: ["member"] }),
        }),
      );
      on(
        http.get("/secure").gate(member),
        flow("secure.ping", {
          effects: {},
          do: () => ({ ok: true }),
        }),
      );

      const first = oke({
        name: "host-keys-first",
        stores: [db1],
        gate: {
          auth: { secret: PEPPER, http: false },
          policies: [member],
        },
        env: "test",
        startScheduler: false,
      });
      await first.boot({ env: "test", startScheduler: false });
      expect(first.apiKeys?.persist).toBeTypeOf("function");

      const created = await first.execute(
        first.flow("keys.create")!,
        {},
        http.post("/keys").gate(member),
        {
          principal: {
            plane: "user",
            userId: "u_issuer",
            scopes: new Set(["member"]),
            verified: true,
          },
        },
      );
      expect(created.failure).toBeUndefined();
      const secret = (created.output as { secret?: string } | undefined)?.secret;
      expect(secret?.startsWith("oke_")).toBe(true);

      const firstStore = first.bootResult?.store;
      await first.stop();
      await firstStore?.close();

      resetIsolated();
      const db2 = store.sql("app", { schema: {} });
      on(
        http.get("/secure").gate(member),
        flow("secure.ping", {
          effects: {},
          do: () => ({ ok: true }),
        }),
      );
      const second = oke({
        name: "host-keys-second",
        stores: [db2],
        gate: {
          auth: { secret: PEPPER, http: false },
          policies: [member],
        },
        env: "test",
        startScheduler: false,
      });
      await second.boot({ env: "test", startScheduler: false });
      expect(second.apiKeys).not.toBe(first.apiKeys);
      expect(second.apiKeys?.keys.size).toBeGreaterThan(0);

      const conn = await second.bootResult?.store?.primarySql();
      const rows = await conn?.query(`SELECT id, name FROM ${AUTH_TABLES.apiKeys}`);
      expect(rows?.some((r) => r.name === "prod-ci")).toBe(true);

      const res = await second.fetch(
        new Request("http://localhost/secure", {
          method: "GET",
          headers: { authorization: `Bearer ${secret}` },
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { ok: true }, error: null });

      const secondStore = second.bootResult?.store;
      await second.stop();
      await secondStore?.close();
    } finally {
      if (prevDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDb;
      if (prevPglite === undefined) delete process.env.OKE_PGLITE_URL;
      else process.env.OKE_PGLITE_URL = prevPglite;
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
