/**
 * `redis` driver — binds `Bun.redis` / `Bun.RedisClient` (never ioredis).
 *
 * Protocol-named: Valkey, Dragonfly, KeyDB, Upstash all speak redis.
 */

import type {
  KvClientLike,
  KvDriver,
  KvNamespace,
  KvOpenOptions,
} from "./types.ts";

/**
 * Open a KV namespace over the redis protocol.
 *
 * @param options - Name / URL / injected client
 */
export async function openRedisKv(
  options: KvOpenOptions,
): Promise<KvNamespace> {
  const client: KvClientLike =
    options.client ??
    createBunRedisClient(options.url);

  const prefix = `oke:kv:${options.name}:`;

  return {
    driverId: "redis",
    async get(key) {
      const raw = await client.get(prefix + key);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return raw;
      }
    },
    async set(key, value, ttl) {
      const payload = JSON.stringify(value);
      const ex =
        ttl !== undefined ? Math.max(1, Math.ceil(ttlToSeconds(ttl))) : undefined;
      if (ex !== undefined) {
        await client.set(prefix + key, payload, { ex });
      } else {
        await client.set(prefix + key, payload);
      }
    },
    async delete(key) {
      const n = await client.del(prefix + key);
      return n > 0;
    },
    async close() {
      /* Bun.redis is process-scoped; injected fakes may no-op */
    },
  };
}

function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(ttl.trim());
  if (!match) return 0;
  const n = Number(match[1]);
  switch (match[2]) {
    case "ms":
      return n / 1000;
    case "s":
      return n;
    case "m":
      return n * 60;
    case "h":
      return n * 3600;
    case "d":
      return n * 86_400;
    default:
      return 0;
  }
}

function createBunRedisClient(url?: string): KvClientLike {
  const redis =
    url !== undefined ? new Bun.RedisClient(url) : Bun.redis;

  return {
    get: (key) => redis.get(key),
    async set(key, value, opts) {
      if (opts?.ex !== undefined) {
        return redis.set(key, value, "EX", opts.ex);
      }
      return redis.set(key, value);
    },
    del: (...keys) => redis.del(...keys),
  };
}

/**
 * In-memory redis-protocol fake for conformance without a server.
 */
export function createRedisFakeClient(): KvClientLike & {
  readonly data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
      return "OK";
    },
    async del(...keys) {
      let n = 0;
      for (const k of keys) {
        if (data.delete(k)) n++;
      }
      return n;
    },
  };
}

/** Protocol-named redis driver. */
export const redisDriver: KvDriver = {
  id: "redis",
  facet: "kv",
  open: openRedisKv,
};
