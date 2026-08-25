/**
 * Store element acceptance:
 * - same flow runs unchanged against memory and postgres
 * - read-only flow provably hits a replica
 * - auto-invalidation fires on exactly the writes touching the read's keys
 * - SELECT * masks classified columns
 */

import { describe, expect, test } from "bun:test";
import { createPostgresFakeClient, memorySqlDriver, postgresDriver } from "../drivers/index.ts";
import type { Effects } from "../manifest/types.ts";
import {
  classify,
  computedCacheKey,
  createStoreCache,
  createStoreRuntime,
  defineTable,
  id,
  isInvalidatedByWrite,
  isReadOnlyStoreFlow,
  maskRows,
  buildClassificationMap,
  now,
  PII_MASK,
  resolveSqlTarget,
  sqlRoleForEffects,
  store,
  tier1KeysForReads,
  type SqlStoreHandle,
} from "./store.ts";

const notes = defineTable("notes", {
  id: true,
  title: true,
  email: classify({ pii: true }),
});

function asSql(handle: unknown): SqlStoreHandle {
  if (
    !handle ||
    typeof handle !== "object" ||
    !("ensureTable" in handle) ||
    typeof (handle as SqlStoreHandle).ensureTable !== "function"
  ) {
    throw new Error("expected sql handle");
  }
  return handle as SqlStoreHandle;
}

/** Flow body — identical for every SQL driver. */
async function notesFlow(handle: SqlStoreHandle) {
  await handle.ensureTable(notes);
  const [created] = await handle
    .insert(notes)
    .values({ id: id(), title: "t", email: "secret@example.com" })
    .returning();
  const listed = await handle.select().from(notes);
  const got = await handle.findById(notes, String(created!.id));
  return { created, listed, got };
}

describe("store facets", () => {
  test("declares sql · kv · files · index with resource refs", () => {
    expect(store.sql("notes").ref).toBe("sql:notes");
    expect(store.kv("sessions").ref).toBe("kv:sessions");
    expect(store.kv("ledger", { durable: true }).durable).toBe(true);
    expect(store.kv("sessions").durable).toBeUndefined();
    expect(store.files("uploads").ref).toBe("files:uploads");
    expect(store.index("kb", { dims: 8 }).ref).toBe("index:kb");
  });

  test("id and now helpers", () => {
    const value = id();
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(value.length).toBe(21);
    expect(now()).toBeGreaterThan(0);
  });
});

describe("same flow against memory and postgres", () => {
  test("insert / select / findById unchanged across drivers", async () => {
    const decl = store.sql("notes", {
      schema: { notes },
      classify: { notes: { email: classify({ pii: true }) } },
    });

    for (const [label, driver, client] of [
      ["memory", memorySqlDriver, undefined],
      ["postgres", postgresDriver, createPostgresFakeClient()],
    ] as const) {
      const runtime = createStoreRuntime({
        drivers: { sql: driver },
        sql: {
          notes: {
            name: "notes",
            primary: { client },
          },
        },
      });
      runtime.register(decl);
      const handle = asSql(
        await runtime.open(decl, {
          effects: { writes: ["sql:notes"], reads: ["sql:notes"] },
        }),
      );
      const result = await notesFlow(handle);
      expect(result.created?.title, label).toBe("t");
      expect(result.listed).toHaveLength(1);
      expect(result.got?.id, label).toBe(result.created?.id);
      // PII masked at boundary even through the flow
      expect(result.listed[0]?.email, label).toBe(PII_MASK);
      await runtime.close();
    }
  });
});

describe("replica routing from effects", () => {
  test("read-only flows are detected from the effect set", () => {
    expect(isReadOnlyStoreFlow({ reads: ["sql:notes"] })).toBe(true);
    expect(isReadOnlyStoreFlow({ reads: ["sql:notes"], writes: ["sql:notes"] })).toBe(false);
    expect(sqlRoleForEffects({ reads: ["sql:notes"] }, true)).toBe("replica");
    expect(sqlRoleForEffects({ reads: ["sql:notes"], writes: ["sql:notes"] }, true)).toBe(
      "primary",
    );
  });

  test("read-only flow provably hits a replica", async () => {
    const primaryClient = createPostgresFakeClient();
    const replicaClient = createPostgresFakeClient();
    // Seed replica only — if primary were used, SELECT would be empty.
    await replicaClient.unsafe(
      `CREATE TABLE IF NOT EXISTS "notes" ("id" TEXT PRIMARY KEY, "title" TEXT, "email" TEXT)`,
    );
    await replicaClient.unsafe(`INSERT INTO "notes" ("id", "title", "email") VALUES ($1, $2, $3)`, [
      "n1",
      "from-replica",
      "x@y.z",
    ]);

    const decl = store.sql("notes", {
      classify: { notes: { email: classify({ pii: true }) } },
    });
    const runtime = createStoreRuntime({
      drivers: { sql: postgresDriver },
      sql: {
        notes: {
          name: "notes",
          primary: { client: primaryClient },
          replicas: [{ client: replicaClient }],
        },
      },
    });
    runtime.register(decl);

    const readEffects: Effects = { reads: ["sql:notes"] };
    const handle = asSql(await runtime.open(decl, { effects: readEffects }));
    expect(handle.routedRole).toBe("replica");
    const rows = await handle.raw(`SELECT * FROM notes`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("from-replica");

    const writeHandle = asSql(
      await runtime.open(decl, {
        effects: { reads: ["sql:notes"], writes: ["sql:notes"] },
      }),
    );
    expect(writeHandle.routedRole).toBe("primary");
    await runtime.close();
  });

  test("resolveSqlTarget picks replica options", () => {
    const target = resolveSqlTarget(
      {
        primary: { url: "postgres://primary" },
        replicas: [{ url: "postgres://replica-1" }],
      },
      { reads: ["sql:notes"] },
    );
    expect(target.role).toBe("replica");
    expect(target.options.url).toBe("postgres://replica-1");
  });
});

describe("tier-1 cache invalidation from effects", () => {
  test("auto-invalidation fires on exactly the writes touching the read's keys", () => {
    const cache = createStoreCache();
    const readEffects: Effects = { reads: ["sql:notes"] };
    const keys = tier1KeysForReads(readEffects);
    expect(keys).toEqual([computedCacheKey("sql:notes")]);

    cache.set({
      tier: 1,
      key: keys[0]!,
      value: [{ id: "n1" }],
      resources: ["sql:notes"],
      expiresAt: null,
    });
    cache.set({
      tier: 1,
      key: computedCacheKey("sql:orders"),
      value: [],
      resources: ["sql:orders"],
      expiresAt: null,
    });
    cache.set({
      tier: 3,
      key: "fx-rate:USD-SAR",
      value: 3.75,
      resources: [],
      expiresAt: null,
    });

    expect(isInvalidatedByWrite(keys[0]!, { writes: ["sql:notes"] })).toBe(true);
    expect(isInvalidatedByWrite(keys[0]!, { writes: ["sql:orders"] })).toBe(false);

    const event = cache.invalidateFromEffects({ writes: ["sql:notes"] });
    expect(event.keys).toEqual([computedCacheKey("sql:notes")]);
    expect(cache.get(computedCacheKey("sql:notes"))).toBeUndefined();
    expect(cache.get<unknown[]>(computedCacheKey("sql:orders"))).toEqual([]);
    expect(cache.get<number>("fx-rate:USD-SAR")).toBe(3.75);
  });

  test("runtime putTier1 + onWriteEffects", async () => {
    const runtime = createStoreRuntime({
      drivers: { sql: memorySqlDriver },
      sql: { notes: { name: "notes", primary: {} } },
    });
    const keys = runtime.putTier1({ reads: ["sql:notes"] }, ["cached"]);
    expect(runtime.cache.get<string[]>(keys[0]!)).toEqual(["cached"]);
    const ev = runtime.onWriteEffects({ writes: ["sql:notes"] });
    expect(ev.keys).toEqual(keys);
    await runtime.close();
  });
});

describe("exists and increment helpers", () => {
  const counters = defineTable("counters", {
    id: true,
    clicks: true,
  });

  test("exists returns correctly for present / absent rows across sqlite and postgres", async () => {
    for (const [label, driver, client] of [
      ["memory", memorySqlDriver, undefined],
      ["postgres", postgresDriver, createPostgresFakeClient()],
    ] as const) {
      const decl = store.sql("counters");
      const runtime = createStoreRuntime({
        drivers: { sql: driver },
        sql: {
          counters: {
            name: "counters",
            primary: { client },
          },
        },
      });
      runtime.register(decl);
      const handle = asSql(
        await runtime.open(decl, {
          effects: { writes: ["sql:counters"], reads: ["sql:counters"] },
        }),
      );
      await handle.ensureTable(counters);
      await handle.insert(counters).values({ id: "c1", clicks: 0 }).execute();

      expect(await handle.exists(counters, { id: "c1" }), label).toBe(true);
      expect(await handle.exists(counters, { id: "gone" }), label).toBe(false);
      await runtime.close();
    }
  });

  test("increment under 100 concurrent callers lands on the correct final value", async () => {
    for (const [label, driver, client] of [
      ["memory", memorySqlDriver, undefined],
      ["postgres", postgresDriver, createPostgresFakeClient()],
    ] as const) {
      const decl = store.sql("counters");
      const runtime = createStoreRuntime({
        drivers: { sql: driver },
        sql: {
          counters: {
            name: "counters",
            primary: { client },
          },
        },
      });
      runtime.register(decl);
      const handle = asSql(
        await runtime.open(decl, {
          effects: { writes: ["sql:counters"], reads: ["sql:counters"] },
        }),
      );
      await handle.ensureTable(counters);
      await handle.insert(counters).values({ id: "c1", clicks: 0 }).execute();

      const n = 100;
      const results = await Promise.all(
        Array.from({ length: n }, () => handle.increment(counters, "c1", "clicks")),
      );
      expect(new Set(results).size, label).toBe(n);
      expect(Math.max(...results), label).toBe(n);
      const row = await handle.findById(counters, "c1");
      expect(Number(row?.clicks), label).toBe(n);
      await runtime.close();
    }
  });
});

describe("PII masking at the driver boundary", () => {
  test("SELECT * masks classified columns", async () => {
    const decl = store.sql("notes", {
      classify: { notes: { email: classify({ pii: true }) } },
    });
    const runtime = createStoreRuntime({
      drivers: { sql: memorySqlDriver },
      sql: { notes: { name: "notes", primary: {} } },
    });
    runtime.register(decl);
    const handle = asSql(
      await runtime.open(decl, {
        effects: { reads: ["sql:notes"], writes: ["sql:notes"] },
      }),
    );
    await handle.ensureTable(notes);
    await handle.insert(notes).values({ id: "1", title: "t", email: "pii@x.com" }).execute();

    const rows = await handle.raw(`SELECT * FROM notes`);
    expect(rows[0]?.title).toBe("t");
    expect(rows[0]?.email).toBe(PII_MASK);

    const revealed = asSql(
      await runtime.open(decl, {
        effects: { reads: ["sql:notes"] },
        revealPii: true,
      }),
    );
    const clear = await revealed.raw(`SELECT * FROM notes`);
    expect(clear[0]?.email).toBe("pii@x.com");
    await runtime.close();
  });

  test("maskRows uses schema classification, not hard-coded names", () => {
    const map = buildClassificationMap({
      users: { phone: classify({ pii: true }) },
    });
    const masked = maskRows([{ id: "1", phone: "555", name: "Ada" }], {
      classifications: map,
      table: "users",
    });
    expect(masked[0]).toEqual({ id: "1", phone: PII_MASK, name: "Ada" });
  });

  test("maskRows aliases ownerEmail / owner_email so raw SQL cannot leak", () => {
    const fromJs = buildClassificationMap({
      views: { ownerEmail: classify({ pii: true }) },
    });
    const fromSql = buildClassificationMap({
      views: { owner_email: classify({ pii: true }) },
    });
    expect(
      maskRows([{ id: "v1", owner_email: "aria@keel.dev" }], {
        classifications: fromJs,
        table: "views",
      })[0],
    ).toEqual({ id: "v1", owner_email: PII_MASK });
    expect(
      maskRows([{ id: "v1", ownerEmail: "ben@keel.dev" }], {
        classifications: fromSql,
        table: "views",
      })[0],
    ).toEqual({ id: "v1", ownerEmail: PII_MASK });
  });
});
