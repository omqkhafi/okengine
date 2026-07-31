/**
 * `configSource` — code floor, DB overrides, automatic KV read-through,
 * and the sync flow's declared effects. Also the plugin-side wiring:
 * hooks follow the box, DB-backed sources contribute their config table.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { memoryKvDriver } from "../drivers/memory.ts";
import { sqliteDriver } from "../drivers/sqlite.ts";
import { store } from "../elements/store/declare.ts";
import { createStoreRuntime } from "../elements/store/runtime.ts";
import type { SqlStoreHandle } from "../elements/store/sql-session.ts";
import { defineTable } from "../elements/store/table.ts";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { createFxContext, type Fx } from "../kernel/fx.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { createPluginRegistry } from "../kernel/registry.ts";
import { http } from "../kernel/triggers.ts";
import { configSource, resolvePluginOptions } from "./config-source.ts";
import { maintenanceMode } from "./maintenance-mode.ts";
import { headers } from "./headers.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

/** A KV-only source against the in-memory stub. */
function kvFx(kvRef: string, seed: Record<string, unknown>): Fx {
  return createFxContext({
    flow: "x.config-sync",
    effects: { reads: [kvRef as `kv:${string}`], writes: [kvRef as `kv:${string}`] },
    storeData: { [kvRef]: seed },
  }).fx;
}

describe("configSource — box semantics", () => {
  test("current() is the code config before any sync", () => {
    const source = configSource({ plugin: "maintenance-mode", code: { enabled: false } });
    expect(source.current()).toEqual({ enabled: false });
    expect(resolvePluginOptions(source)).toEqual({ enabled: false });
  });

  test("sync reads the KV cache and merges it over code", async () => {
    const cfg = store.kv("cfg");
    const source = configSource({
      plugin: "maintenance-mode",
      code: { enabled: false, retryAfter: 60 },
      kv: cfg,
    });

    const fx = kvFx("kv:cfg", { "oke:plugin-config:maintenance-mode": { enabled: true } });
    const outcome = await source.sync().do(undefined, fx);

    expect(outcome).toEqual({ source: "kv" });
    expect(source.current()).toEqual({ enabled: true, retryAfter: 60 });
  });

  test("DB is the source of truth; KV write-back makes the next tick KV-served", async () => {
    const db = store.sql("cfgdb");
    const cfg = store.kv("cfg");
    const runtime = createStoreRuntime({
      drivers: { sql: sqliteDriver, kv: memoryKvDriver },
      sql: { cfgdb: { name: "cfgdb", primary: { url: ":memory:" } } },
      kv: { cfg: {} },
    });
    runtime.register(db);
    runtime.register(cfg);

    const effects = {
      reads: ["sql:cfgdb" as const, "kv:cfg" as const],
      writes: ["sql:cfgdb" as const, "kv:cfg" as const],
    };
    const fx = createFxContext({ flow: "x.config-sync", effects, storeRuntime: runtime }).fx;

    const table = defineTable("headers_config", { key: true, value: true });
    const sql = fx.store(db) as SqlStoreHandle;
    await sql.ensureTable(table);
    await sql
      .insert(table)
      .values({ key: "config", value: JSON.stringify({ hsts: true }) })
      .execute();

    const source = configSource({
      plugin: "headers",
      code: { hsts: false },
      db: { store: db },
      kv: cfg,
    });

    const first = await source.sync().do(undefined, fx);
    expect(first).toEqual({ source: "db" });
    expect(source.current()).toEqual({ hsts: true });

    // Remove the DB row — a fresh invocation must still be served from KV.
    await sql.delete(table, "config");
    const second = await source.sync().do(undefined, fx);
    expect(second).toEqual({ source: "kv" });
    expect(source.current()).toEqual({ hsts: true });
  });

  test("an empty DB reverts to the code config", async () => {
    const db = store.sql("cfgdb");
    const runtime = createStoreRuntime({
      drivers: { sql: sqliteDriver },
      sql: { cfgdb: { name: "cfgdb", primary: { url: ":memory:" } } },
    });
    runtime.register(db);

    const effects = { reads: ["sql:cfgdb" as const], writes: ["sql:cfgdb" as const] };
    const fx = createFxContext({ flow: "x.config-sync", effects, storeRuntime: runtime }).fx;
    const table = defineTable("headers_config", { key: true, value: true });
    await (fx.store(db) as SqlStoreHandle).ensureTable(table);

    const source = configSource({
      plugin: "headers",
      code: { frameOptions: "DENY" as const },
      db: { store: db },
    });
    expect(await source.sync().do(undefined, fx)).toEqual({ source: "code" });
    expect(source.current()).toEqual({ frameOptions: "DENY" });
  });

  test("a corrupt JSON row fails the sync loudly", async () => {
    const db = store.sql("cfgdb");
    const runtime = createStoreRuntime({
      drivers: { sql: sqliteDriver },
      sql: { cfgdb: { name: "cfgdb", primary: { url: ":memory:" } } },
    });
    runtime.register(db);

    const effects = { reads: ["sql:cfgdb" as const], writes: ["sql:cfgdb" as const] };
    const fx = createFxContext({ flow: "x.config-sync", effects, storeRuntime: runtime }).fx;
    const table = defineTable("headers_config", { key: true, value: true });
    const sql = fx.store(db) as SqlStoreHandle;
    await sql.ensureTable(table);
    await sql.insert(table).values({ key: "config", value: "{not json" }).execute();

    const source = configSource({
      plugin: "headers",
      code: {},
      db: { store: db },
    });
    await expect(source.sync().do(undefined, fx)).rejects.toThrow(/not valid JSON/);
  });
});

describe("configSource — plugin wiring", () => {
  test("the maintenanceMode hook follows the box after a sync", async () => {
    const cfg = store.kv("cfg");
    const source = configSource({
      plugin: "maintenance-mode",
      code: { enabled: false },
      kv: cfg,
    });

    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "cfg-live" }).plug(maintenanceMode(source));

    expect((await app.fetch(new Request("http://localhost/x"))).status).toBe(200);

    await source.sync().do(undefined, kvFx("kv:cfg", {}));
    expect((await app.fetch(new Request("http://localhost/x"))).status).toBe(200);

    const seeded = kvFx("kv:cfg", { "oke:plugin-config:maintenance-mode": { enabled: true } });
    await source.sync().do(undefined, seeded);
    expect((await app.fetch(new Request("http://localhost/x"))).status).toBe(503);
  });

  test("DB-backed sources contribute their config table; static options do not", () => {
    const db = store.sql("cfgdb");
    const source = configSource({
      plugin: "headers",
      code: {},
      db: { store: db },
    });

    const registry = createPluginRegistry();
    const registration = registry.plug(headers(source), { kind: "app" });
    expect(registration?.tables.map((t) => t.name)).toEqual(["headers_config"]);

    const staticRegistry = createPluginRegistry();
    const staticRegistration = staticRegistry.plug(headers({}), { kind: "app" });
    expect(staticRegistration?.tables).toEqual([]);
  });

  test("the identity snapshot is the code config, not the live box", async () => {
    const cfg = store.kv("cfg");
    const source = configSource({
      plugin: "maintenance-mode",
      code: { enabled: false },
      kv: cfg,
    });
    await source
      .sync()
      .do(undefined, kvFx("kv:cfg", { "oke:plugin-config:maintenance-mode": { enabled: true } }));

    const registry = createPluginRegistry();
    registry.plug(maintenanceMode(source), { kind: "app" });
    // Double-plug with the same source is a no-op (snapshot still equals code).
    expect(registry.plug(maintenanceMode(source), { kind: "app" })).toBeUndefined();
  });
});
