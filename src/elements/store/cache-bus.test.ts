import { expect, test } from "bun:test";

import { computedCacheKey, createStoreCache, type StoreCache } from "./cache.ts";
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
      if (statement.includes("db_now")) return [{ db_now: now }];
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
