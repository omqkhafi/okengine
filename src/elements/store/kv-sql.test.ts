/**
 * Durable KV on `oke_kv` JSONB — round-trip, TTL purge, cache Redis unchanged.
 */

import { describe, expect, test } from "bun:test";
import { pgliteDriver } from "../../drivers/pglite.ts";
import { createRedisFakeClient, redisDriver } from "../../drivers/redis.ts";
import { memoryDrivers } from "../../drivers/memory.ts";
import { store } from "./declare.ts";
import { openSqlKvNamespace } from "./kv-sql.ts";
import { createStoreRuntime, type KvStoreFxHandle } from "./runtime.ts";

const ctx = { effects: {} };

describe("oke_kv JSONB durable namespace", () => {
  test("set/get/delete round-trips a JSON object", async () => {
    const conn = await pgliteDriver.connect({ url: "memory://" });
    try {
      const ns = await openSqlKvNamespace({
        conn,
        namespace: "ledger",
        now: () => 1_000_000,
      });
      expect(ns.driverId).toBe("pglite");
      await ns.set("idemp", { orderId: "o1", n: 2 });
      expect(await ns.get("idemp")).toEqual({ orderId: "o1", n: 2 });
      expect(await ns.list("id")).toEqual(["idemp"]);
      expect(await ns.delete("idemp")).toBe(true);
      expect(await ns.get("idemp")).toBeUndefined();
    } finally {
      await conn.close();
    }
  });

  test("expired keys are invisible and purgeExpired removes the row", async () => {
    const conn = await pgliteDriver.connect({ url: "memory://" });
    let t = 1_000_000;
    try {
      const ns = await openSqlKvNamespace({
        conn,
        namespace: "ledger",
        now: () => t,
      });
      await ns.set("fresh", { ok: true }, "5s");
      await ns.set("stale", { ok: false }, "1s");
      t += 1_500;
      expect(await ns.get("stale")).toBeUndefined();
      expect(await ns.get("fresh")).toEqual({ ok: true });
      const removed = await ns.purgeExpired();
      expect(removed).toBe(1);
      const leftover = await conn.query(`SELECT key FROM oke_kv WHERE key = ?`, ["stale"]);
      expect(leftover).toEqual([]);
    } finally {
      await conn.close();
    }
  });

  test("non-durable namespace stays on redis; durable uses pglite", async () => {
    const fake = createRedisFakeClient();
    const sessions = store.kv("sessions");
    const ledger = store.kv("ledger", { durable: true });
    const runtime = createStoreRuntime({
      drivers: {
        sql: pgliteDriver,
        kv: redisDriver,
        files: memoryDrivers.files,
        index: memoryDrivers.index,
      },
      sqlUrl: "memory://",
      kv: { sessions: { url: "redis://cache", client: fake } },
      now: () => 1_000_000,
    });
    runtime.register(sessions);
    runtime.register(ledger);
    const cache = (await runtime.open(sessions, ctx)) as KvStoreFxHandle;
    const durable = (await runtime.open(ledger, ctx)) as KvStoreFxHandle;
    expect(cache.driverId).toBe("redis");
    expect(durable.driverId).toBe("pglite");
    await cache.set("sid", { user: "a" });
    await durable.set("idemp", { orderId: "o1" });
    expect(await cache.get("sid")).toEqual({ user: "a" });
    expect(await durable.get("idemp")).toEqual({ orderId: "o1" });
    expect([...fake.data.keys()].some((k) => k.includes("idemp"))).toBe(false);
    await runtime.close();
  });
});
