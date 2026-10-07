/**
 * Nested `transaction()` uses SAVEPOINT on the pinned connection.
 * Live Postgres cases need `OKE_TEST_POSTGRES_URL` or `OKE_TEST_POSTGRES=1`
 * plus `DATABASE_URL` / `OKE_STORE_SQL_URL`.
 */

import { describe, expect, test } from "bun:test";
import type { SignalBus } from "../../drivers/signal-types.ts";
import { memorySignalDriver } from "../../drivers/signal-memory.ts";
import { connectPostgres } from "../../drivers/postgres.ts";
import type { SqlConnection, SqlRow } from "../../drivers/types.ts";
import { createFxContext } from "../../kernel/fx.ts";
import type { SignalRuntime } from "../signal/runtime.ts";
import { signal } from "../signal.ts";
import type { StoreRuntime } from "./runtime.ts";
import { createSqlStoreHandle, type SqlStoreHandle } from "./sql-session.ts";
import { store } from "./declare.ts";

const LIVE_POSTGRES_URL =
  process.env.OKE_TEST_POSTGRES_URL?.trim() ||
  (process.env.OKE_TEST_POSTGRES === "1"
    ? (process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL)?.trim()
    : undefined);

if (!LIVE_POSTGRES_URL) {
  console.log(
    "skip: nested transaction live postgres (set OKE_TEST_POSTGRES_URL or OKE_TEST_POSTGRES=1 + DATABASE_URL/OKE_STORE_SQL_URL)",
  );
}

function scriptedConnection(): { readonly connection: SqlConnection; readonly log: string[] } {
  const log: string[] = [];
  const pinned: SqlConnection = {
    driverId: "postgres",
    role: "primary",
    async query() {
      return [];
    },
    async exec(sql) {
      log.push(sql);
      return { changes: 0 };
    },
    async transaction() {
      throw new Error("nested transaction reserved a second connection");
    },
    async close() {},
  };
  const connection: SqlConnection = {
    driverId: "postgres",
    role: "primary",
    async query() {
      return [];
    },
    async exec(sql) {
      log.push(sql);
      return { changes: 0 };
    },
    async transaction(fn) {
      log.push("BEGIN");
      try {
        const result = await fn(pinned);
        log.push("COMMIT");
        return result;
      } catch (err) {
        log.push("ROLLBACK");
        throw err;
      }
    },
    async close() {},
  };
  return { connection, log };
}

function handleFor(connection: SqlConnection): SqlStoreHandle {
  return createSqlStoreHandle("sql:db", {
    connection,
    classifications: new Map(),
    routedRole: "primary",
    domainDdl: "off",
  });
}

describe("nested transaction (fake connection)", () => {
  test("nested calls SAVEPOINT and RELEASE on the pinned connection", async () => {
    const { connection, log } = scriptedConnection();
    const handle = handleFor(connection);
    await handle.transaction(async (tx) => {
      await tx.transaction(async (inner) => {
        await inner.transaction(async () => undefined);
      });
    });
    expect(log).toEqual([
      "BEGIN",
      'SAVEPOINT "oke_sp_1_1"',
      'SAVEPOINT "oke_sp_2_2"',
      'RELEASE SAVEPOINT "oke_sp_2_2"',
      'RELEASE SAVEPOINT "oke_sp_1_1"',
      "COMMIT",
    ]);
  });

  test("sibling savepoints get distinct names", async () => {
    const { connection, log } = scriptedConnection();
    const handle = handleFor(connection);
    await handle.transaction(async (tx) => {
      await tx.transaction(async () => undefined);
      await tx.transaction(async () => undefined);
    });
    expect(log).toEqual([
      "BEGIN",
      'SAVEPOINT "oke_sp_1_1"',
      'RELEASE SAVEPOINT "oke_sp_1_1"',
      'SAVEPOINT "oke_sp_1_2"',
      'RELEASE SAVEPOINT "oke_sp_1_2"',
      "COMMIT",
    ]);
  });

  test("inner throw rolls back to the savepoint even when the outer catch swallows it", async () => {
    const { connection, log } = scriptedConnection();
    const handle = handleFor(connection);
    await handle.transaction(async (tx) => {
      await tx.raw("INSERT INTO notes (id) VALUES ('outer')");
      try {
        await tx.transaction(async (inner) => {
          await inner.raw("INSERT INTO notes (id) VALUES ('inner')");
          throw new Error("inner");
        });
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe("inner");
      }
      await tx.raw("INSERT INTO notes (id) VALUES ('after')");
    });
    expect(log).toEqual([
      "BEGIN",
      "INSERT INTO notes (id) VALUES ('outer')",
      'SAVEPOINT "oke_sp_1_1"',
      "INSERT INTO notes (id) VALUES ('inner')",
      'ROLLBACK TO SAVEPOINT "oke_sp_1_1"',
      "INSERT INTO notes (id) VALUES ('after')",
      "COMMIT",
    ]);
  });

  test("concurrent inner transactions on one connection do not interleave", async () => {
    const { connection } = scriptedConnection();
    const handle = handleFor(connection);
    const order: string[] = [];
    await handle.transaction(async (tx) => {
      await Promise.all([
        tx.transaction(async () => {
          order.push("a1");
          await Bun.sleep(30);
          order.push("a2");
        }),
        tx.transaction(async () => {
          order.push("b1");
          await Bun.sleep(30);
          order.push("b2");
        }),
      ]);
    });
    expect(order).toEqual(order[0] === "a1" ? ["a1", "a2", "b1", "b2"] : ["b1", "b2", "a1", "a2"]);
  });
});

describe("nested transaction signals", () => {
  async function openFx(connection: SqlConnection): Promise<{
    readonly fx: ReturnType<typeof createFxContext>["fx"];
    readonly bus: SignalBus;
    readonly ping: ReturnType<typeof signal.once>;
    readonly close: () => Promise<void>;
  }> {
    const ping = signal.once("ping");
    const signals = new Map([[ping.name, ping]]);
    const bus = await memorySignalDriver.open({ signals });
    const signalRuntime: SignalRuntime = {
      driverId: "memory",
      get bus() {
        return bus;
      },
      declarations: signals,
      register(decl) {
        signals.set(decl.name, decl);
      },
      async start() {
        return bus;
      },
      emit: (name, payload, options) => bus.emit(name, payload, options),
      deadLetters: (name) => bus.deadLetters(name),
      live: (name, opts) => bus.live(name, opts),
      checkLiveResume: (name, afterId) => bus.checkLiveResume(name, afterId),
      async close() {
        await bus.close();
      },
    };
    const storeRuntime = {
      async open() {
        return handleFor(connection);
      },
    } as unknown as StoreRuntime;
    const { fx } = createFxContext({
      flow: "notes.write",
      effects: { writes: ["sql:db"], emits: ["ping"] },
      storeRuntime,
      signalRuntime,
    });
    return {
      fx,
      bus,
      ping,
      async close() {
        await bus.close();
      },
    };
  }

  test("nested emits merge and publish only on the outermost commit", async () => {
    const { connection } = scriptedConnection();
    const { fx, bus, ping, close } = await openFx(connection);
    const got: unknown[] = [];
    await bus.subscribe("ping", "c", async (message) => {
      got.push(message.payload);
    });
    const db = store.sql("db");
    try {
      await fx.store(db).transaction(async (tx) => {
        await fx.emit(ping, { id: "outer" });
        await tx.transaction(async () => {
          await fx.emit(ping, { id: "inner" });
        });
        await bus.drain();
        expect(got).toEqual([]);
      });
      await bus.drain();
      expect(got).toEqual([{ id: "outer" }, { id: "inner" }]);
    } finally {
      await close();
    }
  });

  test("a thrown nested transaction discards its emits", async () => {
    const { connection } = scriptedConnection();
    const { fx, bus, ping, close } = await openFx(connection);
    const got: unknown[] = [];
    await bus.subscribe("ping", "c", async (message) => {
      got.push(message.payload);
    });
    const db = store.sql("db");
    try {
      await fx.store(db).transaction(async (tx) => {
        await fx.emit(ping, { id: "outer" });
        try {
          await tx.transaction(async () => {
            await fx.emit(ping, { id: "no" });
            throw new Error("nope");
          });
        } catch (err) {
          expect((err as Error).message).toBe("nope");
        }
      });
      await bus.drain();
      expect(got).toEqual([{ id: "outer" }]);
    } finally {
      await close();
    }
  });
});

function scratchTable(prefix: string): string {
  const name = `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`unsafe table name: ${name}`);
  }
  return name;
}

describe.skipIf(!LIVE_POSTGRES_URL)("nested transaction (postgres)", () => {
  test("inner throw rolls back only the inner write; outer commit keeps the outer write", async () => {
    const url = LIVE_POSTGRES_URL;
    if (!url) throw new Error("postgres url missing");
    const conn = await connectPostgres({ url, pool: { max: 1 } });
    const table = scratchTable("oke_nested");
    const handle = handleFor(conn);
    try {
      await conn.exec(`CREATE TABLE "${table}" (id text PRIMARY KEY, note text)`);
      await handle.transaction(async (tx) => {
        await tx.raw(`INSERT INTO "${table}" (id, note) VALUES (?, ?)`, ["outer", "keep"]);
        try {
          await tx.transaction(async (inner) => {
            await inner.raw(`INSERT INTO "${table}" (id, note) VALUES (?, ?)`, ["inner", "drop"]);
            throw new Error("inner");
          });
        } catch (err) {
          expect((err as Error).message).toBe("inner");
        }
      });
      const rows = await conn.query(`SELECT id FROM "${table}" ORDER BY id`);
      expect(rows.map((row) => row.id)).toEqual(["outer"]);
    } finally {
      await conn.exec(`DROP TABLE IF EXISTS "${table}"`);
      await conn.close();
    }
  });

  test("two concurrent inner transactions on one connection do not interleave", async () => {
    const url = LIVE_POSTGRES_URL;
    if (!url) throw new Error("postgres url missing");
    const conn = await connectPostgres({ url, pool: { max: 1 } });
    const table = scratchTable("oke_nested_race");
    const handle = handleFor(conn);
    const order: string[] = [];
    try {
      await conn.exec(`CREATE TABLE "${table}" (id text PRIMARY KEY)`);
      await handle.transaction(async (tx) => {
        await Promise.all([
          tx.transaction(async (inner) => {
            await inner.raw(`INSERT INTO "${table}" (id) VALUES (?)`, ["a1"]);
            order.push("a1");
            await Bun.sleep(40);
            await inner.raw(`INSERT INTO "${table}" (id) VALUES (?)`, ["a2"]);
            order.push("a2");
          }),
          tx.transaction(async (inner) => {
            await inner.raw(`INSERT INTO "${table}" (id) VALUES (?)`, ["b1"]);
            order.push("b1");
            await Bun.sleep(40);
            await inner.raw(`INSERT INTO "${table}" (id) VALUES (?)`, ["b2"]);
            order.push("b2");
          }),
        ]);
      });
      expect(order).toEqual(
        order[0] === "a1" ? ["a1", "a2", "b1", "b2"] : ["b1", "b2", "a1", "a2"],
      );
      const rows = await conn.query(`SELECT id FROM "${table}" ORDER BY id`);
      expect(rows.map((row: SqlRow) => row.id)).toEqual(["a1", "a2", "b1", "b2"]);
    } finally {
      await conn.exec(`DROP TABLE IF EXISTS "${table}"`);
      await conn.close();
    }
  });
});
