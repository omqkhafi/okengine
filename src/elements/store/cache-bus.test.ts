import { expect, test } from "bun:test";

import { postgresDriver, sharedPostgresClient } from "../../drivers/postgres.ts";
import { oke } from "../../kernel/app.ts";
import { flow, type AnyFlowDef } from "../../kernel/flow.ts";
import type { Binding } from "../../kernel/on.ts";
import { http } from "../../kernel/triggers.ts";
import { gate } from "../gate.ts";
import { computedCacheKey, createStoreCache, type StoreCache } from "./cache.ts";
import { sql } from "./declare.ts";
import { createStoreRuntime, type StoreRuntime } from "./runtime.ts";

const LIVE_PG =
  process.env.OKE_TEST_POSTGRES_URL?.trim() ||
  (process.env.OKE_TEST_POSTGRES === "1"
    ? (process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL)?.trim()
    : undefined);
import {
  CACHE_INVALIDATE_CHANNEL,
  openCacheInvalidation,
  type CacheBusRedis,
  type CacheBusSql,
} from "./cache-bus.ts";

function hub(): { client: () => CacheBusRedis } {
  const subs = new Map<string, Set<(message: string) => void>>();
  return {
    client: () => ({
      async publish(channel, message) {
        const set = subs.get(channel);
        if (!set) return 0;
        for (const listener of [...set]) listener(message);
        return set.size;
      },
      async subscribe(channel, listener) {
        const set = subs.get(channel) ?? new Set<(message: string) => void>();
        subs.set(channel, set);
        set.add(listener);
        return () => {
          set.delete(listener);
        };
      },
    }),
  };
}

function seed(cache: StoreCache, resource: "sql:notes"): string {
  const key = computedCacheKey(resource);
  cache.set({ tier: 1, key, value: { n: 1 }, resources: [resource], expiresAt: null });
  return key;
}

test("redis invalidation drops the other instance and does not republish", async () => {
  const bus = hub();
  let publishA = 0;
  const redisA = bus.client();
  const publish = redisA.publish.bind(redisA);
  redisA.publish = async (channel, message) => {
    publishA += 1;
    return publish(channel, message);
  };
  const cacheA = createStoreCache();
  const cacheB = createStoreCache();
  const a = openCacheInvalidation(cacheA, { kind: "redis", redis: redisA, origin: "a" });
  const b = openCacheInvalidation(cacheB, { kind: "redis", redis: bus.client(), origin: "b" });
  await Promise.resolve();
  const key = seed(cacheA, "sql:notes");
  seed(cacheB, "sql:notes");
  b.publish(["sql:notes"]);
  await Promise.resolve();
  expect(cacheA.get(key)).toBeUndefined();
  expect(cacheB.get<{ n: number }>(key)).toEqual({ n: 1 });
  expect(publishA).toBe(0);
  expect(CACHE_INVALIDATE_CHANNEL).toBe("oke:cache:invalidate");
  await a.stop();
  await b.stop();
});

test("postgres invalidation is polled once and skips the sender", async () => {
  const rows: Array<{ id: string; resource: string; origin: string; created_at: number }> = [];
  let now = 1_000_000;
  const sql = (): CacheBusSql => ({
    async exec(statement, params) {
      if (statement.startsWith("CREATE")) return { changes: 0 };
      if (statement.startsWith("INSERT")) {
        rows.push({
          id: String(params?.[0]),
          resource: String(params?.[1]),
          origin: String(params?.[2]),
          created_at: now,
        });
        return { changes: 1 };
      }
      if (statement.startsWith("DELETE")) {
        const cutoff = Number(params?.[0]);
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i]!.created_at < cutoff) rows.splice(i, 1);
        }
        return { changes: 0 };
      }
      throw new Error(`unmatched ${statement}`);
    },
    async query(statement) {
      if (statement.includes("cache_clock")) {
        return [{ db_now: now }, ...rows.map((row) => ({ ...row, db_now: now }))];
      }
      if (statement.includes("db_now")) return [{ db_now: now }];
      if (statement.includes("oke_instances")) return [{ n: 1 }];
      if (statement.includes("FROM oke_cache_invalidations"))
        return rows.map((row) => ({ ...row }));
      throw new Error(`unmatched ${statement}`);
    },
  });
  const cacheA = createStoreCache();
  const cacheB = createStoreCache();
  const a = openCacheInvalidation(cacheA, {
    kind: "postgres",
    origin: "a",
    sql: async () => sql(),
  });
  const b = openCacheInvalidation(cacheB, {
    kind: "postgres",
    origin: "b",
    sql: async () => sql(),
  });
  await a.poll();
  await b.poll();
  const key = seed(cacheA, "sql:notes");
  seed(cacheB, "sql:notes");
  now += 5;
  b.publish(["sql:notes"]);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await a.poll();
  await b.poll();
  expect(cacheA.get(key)).toBeUndefined();
  expect(cacheB.get<{ n: number }>(key)).toEqual({ n: 1 });
  await a.stop();
  await b.stop();
});

test("a row that already exists at open is not applied, and the first later poll is", async () => {
  const rows: Array<{ id: string; resource: string; origin: string; created_at: number }> = [
    { id: "old", resource: "sql:notes", origin: "b", created_at: 1_000 },
  ];
  let now = 1_000;
  const sql = (): CacheBusSql => ({
    async exec(statement, params) {
      if (statement.startsWith("CREATE")) return { changes: 0 };
      if (statement.startsWith("INSERT")) {
        rows.push({
          id: String(params?.[0]),
          resource: String(params?.[1]),
          origin: String(params?.[2]),
          created_at: now,
        });
        return { changes: 1 };
      }
      if (statement.startsWith("DELETE")) return { changes: 0 };
      throw new Error(`unmatched ${statement}`);
    },
    async query(statement) {
      if (statement.includes("cache_clock")) {
        return [{ db_now: now }, ...rows.map((row) => ({ ...row, db_now: now }))];
      }
      if (statement.includes("db_now")) return [{ db_now: now }];
      if (statement.includes("oke_instances")) return [{ n: 1 }];
      if (statement.includes("FROM oke_cache_invalidations"))
        return rows.map((row) => ({ ...row }));
      throw new Error(`unmatched ${statement}`);
    },
  });
  const cacheA = createStoreCache();
  const key = seed(cacheA, "sql:notes");
  const a = openCacheInvalidation(cacheA, {
    kind: "postgres",
    origin: "a",
    sql: async () => sql(),
  });
  await a.poll();
  expect(cacheA.get<{ n: number }>(key)).toEqual({ n: 1 });
  now += 5;
  rows.push({ id: "new", resource: "sql:notes", origin: "b", created_at: now });
  await a.poll();
  expect(cacheA.get(key)).toBeUndefined();
  await a.stop();
});

test("a single instance and an uncached resource write no rows, and a second instance batches", async () => {
  const inserts: Array<{ sql: string; params: readonly unknown[] }> = [];
  const sqlFor = (alive: number): (() => CacheBusSql) => {
    return () => ({
      async exec(statement, params) {
        if (statement.startsWith("INSERT")) inserts.push({ sql: statement, params: params ?? [] });
        return { changes: 0 };
      },
      async query(statement) {
        if (statement.includes("cache_clock")) return [{ db_now: 1 }];
        if (statement.includes("db_now")) return [{ db_now: 1 }];
        if (statement.includes("oke_instances")) return [{ n: alive }];
        if (statement.includes("oke_cache_invalidations")) return [];
        throw new Error(`unmatched ${statement}`);
      },
    });
  };
  let aloneBus!: ReturnType<typeof openCacheInvalidation>;
  const alone = createStoreCache({
    fanout: (resources) => {
      aloneBus.publish(resources);
    },
  });
  aloneBus = openCacheInvalidation(alone, {
    kind: "postgres",
    origin: "self",
    sql: async () => sqlFor(0)(),
  });
  await aloneBus.poll();
  alone.invalidate(["sql:notes"]);
  alone.set({
    tier: 1,
    key: "held",
    value: 1,
    resources: ["sql:notes"],
    expiresAt: null,
  });
  alone.invalidate(["sql:notes"]);
  let peerBus!: ReturnType<typeof openCacheInvalidation>;
  const peer = createStoreCache({
    fanout: (resources) => {
      peerBus.publish(resources);
    },
  });
  peerBus = openCacheInvalidation(peer, {
    kind: "postgres",
    origin: "self",
    sql: async () => sqlFor(1)(),
  });
  await peerBus.poll();
  peer.set({ tier: 1, key: "a", value: 1, resources: ["sql:notes"], expiresAt: null });
  peer.set({ tier: 1, key: "b", value: 2, resources: ["sql:orders"], expiresAt: null });
  peer.invalidate(["sql:notes", "sql:orders"]);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(inserts).toHaveLength(1);
  expect(inserts[0]?.sql).toBe(
    "INSERT INTO oke_cache_invalidations (id, resource, origin) VALUES (?, ?, ?), (?, ?, ?)",
  );
  expect(inserts[0]?.params[1]).toBe("sql:notes");
  expect(inserts[0]?.params[4]).toBe("sql:orders");
  await aloneBus.stop();
  await peerBus.stop();
});

test.skipIf(!LIVE_PG)(
  "two postgres runtimes drop a cached read within 2s when the scheduler is off",
  async () => {
    const url = LIVE_PG!;
    const admin = sharedPostgresClient(url);
    await admin.unsafe(`CREATE TABLE IF NOT EXISTS oke_instances (
      id TEXT PRIMARY KEY,
      started_at BIGINT NOT NULL,
      heartbeat_at BIGINT NOT NULL,
      lease_expires_at BIGINT NOT NULL,
      env TEXT NOT NULL,
      pid INTEGER
    )`);
    await admin.unsafe(
      `INSERT INTO oke_instances (id, started_at, heartbeat_at, lease_expires_at, env, pid) VALUES ('peer', 1, 1, 9999999999999, 'test', 1) ON CONFLICT (id) DO UPDATE SET lease_expires_at = EXCLUDED.lease_expires_at`,
    );
    const db = sql("db");
    let reads = 0;
    const read = flow("cache.poll.read", {
      effects: { reads: ["sql:db"] },
      do: () => {
        reads += 1;
        return { n: reads };
      },
    });
    const write = flow("cache.poll.write", {
      effects: { writes: ["sql:db"] },
      do: () => ({ ok: true as const }),
    });
    const storeFor = (origin: string): StoreRuntime => {
      let store!: StoreRuntime;
      store = createStoreRuntime({
        drivers: { sql: postgresDriver },
        sql: { db: { name: "db", primary: { url } } },
        cacheBus: { kind: "postgres", origin, sql: () => store.primarySql() },
      });
      store.register?.(db);
      return store;
    };
    const appFor = (name: string, origin: string, bindings: Binding[]) =>
      oke({
        name,
        env: "test",
        autoBoot: false,
        startScheduler: false,
        stores: [db],
        bindings,
        gate: { unguardedHttp: "allow", policies: [gate.public] },
        elements: { store: storeFor(origin) },
      });
    const appA = appFor("cache-poll-a", "a", [
      { trigger: http.get("/read").public(), flow: read as AnyFlowDef },
    ]);
    const appB = appFor("cache-poll-b", "b", [
      { trigger: http.post("/write").public(), flow: write as AnyFlowDef },
    ]);
    try {
      await appA.boot();
      await appB.boot();
      expect((await appA.fetch(new Request("http://127.0.0.1/read"))).status).toBe(200);
      expect((await appA.fetch(new Request("http://127.0.0.1/read"))).status).toBe(200);
      expect(reads).toBe(1);
      expect(
        (
          await appB.fetch(
            new Request("http://127.0.0.1/write", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            }),
          )
        ).status,
      ).toBe(200);
      const deadline = Date.now() + 2_000;
      let dropped = false;
      while (Date.now() < deadline) {
        await appA.fetch(new Request("http://127.0.0.1/read"));
        if (reads >= 2) {
          dropped = true;
          break;
        }
        await Bun.sleep(50);
      }
      expect(dropped).toBe(true);
    } finally {
      await appA.stop();
      await appB.stop();
    }
  },
  10_000,
);

if (!LIVE_PG) {
  test("skip: postgres cache poll (set OKE_TEST_POSTGRES_URL or OKE_TEST_POSTGRES=1 + DATABASE_URL)", () => {
    expect(LIVE_PG).toBeUndefined();
  });
}
