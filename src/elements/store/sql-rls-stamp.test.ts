/**
 * RLS stamps on pooled postgres must `reserve()` one slot, then BEGIN/SET
 * on that slot. `begin()` + parent `unsafe()` checkouts a second slot and
 * deadlocks a tiny pool (`checkout timeout` from PgDog).
 */

import { describe, expect, test } from "bun:test";
import { connectPostgres, type PostgresClientLike } from "../../drivers/postgres.ts";
import { createSqlStoreHandle } from "./sql-session.ts";

/**
 * Two-slot pool. `reserve()` holds a slot until `release()`. Unreserved
 * `BEGIN` occupies a slot until COMMIT on that same checkout.
 */
function createTinyPoolClient(size = 2): PostgresClientLike & {
  readonly reserveCalls: { n: number };
  readonly rootBegins: { n: number };
} {
  const slots = Array.from({ length: size }, () => ({ held: false }));
  const reserveCalls = { n: 0 };
  const rootBegins = { n: 0 };

  function checkout(): { held: boolean } {
    const idle = slots.find((slot) => !slot.held);
    if (!idle) {
      throw new Error("checkout timeout");
    }
    return idle;
  }

  function rowsFor(sql: string): Record<string, unknown>[] {
    return /select/i.test(sql) && !/set_config/i.test(sql) ? [{ id: "a", owner: "alice" }] : [];
  }

  const client: PostgresClientLike & {
    readonly reserveCalls: { n: number };
    readonly rootBegins: { n: number };
  } = {
    reserveCalls,
    rootBegins,
    async reserve() {
      reserveCalls.n += 1;
      const slot = checkout();
      slot.held = true;
      return {
        async unsafe(sql) {
          return rowsFor(sql);
        },
        release() {
          slot.held = false;
        },
      };
    },
    async unsafe(sql) {
      const slot = checkout();
      const head = sql.trim().split(/\s+/)[0]?.toUpperCase();
      if (head === "BEGIN") {
        rootBegins.n += 1;
        slot.held = true;
        return [];
      }
      if (head === "COMMIT" || head === "ROLLBACK") {
        slot.held = false;
        return [];
      }
      return rowsFor(sql);
    },
  };
  return client;
}

describe("sql-session RLS stamp on pooled postgres", () => {
  test("pins the stamp through reserve — no leaked root BEGIN", async () => {
    const pool = createTinyPoolClient(2);
    const connection = await connectPostgres({ client: pool, role: "primary" });
    const handle = createSqlStoreHandle("sql:app", {
      connection,
      classifications: new Map(),
      routedRole: "primary",
      domainDdl: "off",
      rls: { gate: "member", userId: "alice", scopes: ["member"] },
    });

    const [a, b] = await Promise.all([
      handle.raw(`SELECT id, owner FROM notes`),
      handle.raw(`SELECT id, owner FROM notes`),
    ]);

    expect(a).toEqual([{ id: "a", owner: "alice" }]);
    expect(b).toEqual([{ id: "a", owner: "alice" }]);
    expect(pool.reserveCalls.n).toBe(2);
    expect(pool.rootBegins.n).toBe(0);
  });

  test("table browse SELECT pins through reserve like any other stamped query", async () => {
    const pool = createTinyPoolClient(2);
    const connection = await connectPostgres({ client: pool, role: "primary" });
    const handle = createSqlStoreHandle("sql:app", {
      connection,
      classifications: new Map(),
      routedRole: "primary",
      domainDdl: "off",
      rls: { gate: "member", userId: "alice", scopes: ["member"] },
    });
    const rows = await handle.raw(`SELECT * FROM "notes" LIMIT 50`);
    expect(rows).toEqual([{ id: "a", owner: "alice" }]);
    expect(pool.reserveCalls.n).toBe(1);
    expect(pool.rootBegins.n).toBe(0);
  });

  test("standalone BEGIN on a 2-slot pool reproduces checkout timeout", async () => {
    const pool = createTinyPoolClient(2);
    await expect(pool.unsafe("BEGIN")).resolves.toEqual([]);
    await expect(pool.unsafe("BEGIN")).resolves.toEqual([]);
    await expect(pool.unsafe("SET LOCAL ROLE oke_app")).rejects.toThrow("checkout timeout");
  });
});
