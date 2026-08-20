/**
 * `redis` driver — binds `Bun.redis` / `Bun.RedisClient` (never ioredis).
 *
 * Protocol-named: Valkey, Dragonfly, KeyDB, Upstash all speak redis.
 */

import { LuaKvStore } from "./kv-lua.ts";
import type { KvClientLike, KvDriver, KvNamespace, KvOpenOptions } from "./types.ts";

/**
 * Open a KV namespace over the redis protocol.
 *
 * @param options - Name / URL / injected client
 */
export async function openRedisKv(options: KvOpenOptions): Promise<KvNamespace> {
  const client: KvClientLike = options.client ?? createBunRedisClient(options.url);

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
      const ex = ttl !== undefined ? Math.max(1, Math.ceil(ttlToSeconds(ttl))) : undefined;
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
    async list(listPrefix = "") {
      const match = prefix + listPrefix + "*";
      const keys = await scanAll(client, match);
      return keys
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .sort();
    },
    async ttlMs(key) {
      if (!client.send) return null;
      const raw = await client.send("PTTL", [prefix + key]);
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return null;
      return n;
    },
    async eval<T = unknown>(
      script: string,
      keys: readonly string[],
      args: readonly string[] = [],
    ): Promise<T> {
      const prefixed = keys.map((k) => prefix + k);
      const keysAndArgs = [...prefixed, ...args];
      if (client.eval) {
        return (await client.eval(script, prefixed.length, ...keysAndArgs)) as T;
      }
      if (client.send) {
        return (await client.send("EVAL", [script, String(prefixed.length), ...keysAndArgs])) as T;
      }
      throw new Error("redis kv.eval: client lacks eval/send");
    },
    async close() {
      /* Bun.redis is process-scoped; injected fakes may no-op */
    },
    ...(client.send
      ? {
          send: (command: string, args: readonly string[] = []) => client.send!(command, [...args]),
        }
      : {}),
  };
}

/**
 * SCAN the keyspace (or fall back to a fake client's in-memory map).
 *
 * @param client - Redis-like client
 * @param match - MATCH pattern
 */
async function scanAll(client: KvClientLike, match: string): Promise<string[]> {
  if (client.scan) {
    const out: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await client.scan(cursor, {
        match,
        count: 100,
      });
      out.push(...batch);
      cursor = next;
    } while (cursor !== "0");
    return out;
  }
  if (client.send) {
    const out: string[] = [];
    let cursor = "0";
    do {
      const reply = (await client.send("SCAN", [cursor, "MATCH", match, "COUNT", "100"])) as [
        string,
        string[],
      ];
      const next = String(reply[0]);
      const batch = reply[1] ?? [];
      out.push(...batch);
      cursor = next;
    } while (cursor !== "0");
    return out;
  }
  throw new Error("redis kv.list: client lacks SCAN — key browse refused rather than KEYS *");
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

/** Bun 1.4 typed methods — `@types/bun` may lag the runtime. */
interface BunRedisEval {
  eval(script: string, numkeys: number, ...keysAndArgs: string[]): Promise<unknown>;
}

function typedRedis(redis: Bun.RedisClient): Bun.RedisClient & BunRedisEval {
  return redis as Bun.RedisClient & BunRedisEval;
}

/**
 * Bind {@link Bun.RedisClient} / {@link Bun.redis} to {@link KvClientLike}.
 *
 * Uses typed `scan` / `eval` (Bun ≥1.4). `send` remains the escape hatch.
 *
 * @param url - Optional Redis URL
 */
export function createBunRedisClient(url?: string): KvClientLike {
  const redis = url !== undefined ? new Bun.RedisClient(url) : Bun.redis;

  return {
    get: (key) => redis.get(key),
    async set(key, value, opts) {
      if (opts?.ex !== undefined) {
        return redis.set(key, value, "EX", opts.ex);
      }
      return redis.set(key, value);
    },
    del: (...keys) => redis.del(...keys),
    async scan(cursor, opts) {
      // Typed Bun.RedisClient.scan — closed gap vs earlier send("SCAN") only.
      if (opts?.match !== undefined && opts.count !== undefined) {
        return redis.scan(cursor, "MATCH", opts.match, "COUNT", opts.count);
      }
      if (opts?.match !== undefined) {
        return redis.scan(cursor, "MATCH", opts.match);
      }
      if (opts?.count !== undefined) {
        return redis.scan(cursor, "COUNT", opts.count);
      }
      return redis.scan(cursor);
    },
    async eval(script, numkeys, ...keysAndArgs) {
      return typedRedis(redis).eval(script, numkeys, ...keysAndArgs);
    },
    send: (command, args) => redis.send(command, args),
  };
}

/**
 * In-memory redis-protocol fake for conformance without a server.
 * Supports `EVAL` via {@link LuaKvStore} for Gate rate strategies.
 */
export function createRedisFakeClient(nowMs?: () => number): KvClientLike & {
  readonly data: Map<string, string>;
  readonly lua: LuaKvStore;
} {
  const data = new Map<string, string>();
  const lua = new LuaKvStore(nowMs);
  /** Serialize EVAL for concurrency tests. */
  let evalChain: Promise<unknown> = Promise.resolve();

  return {
    data,
    lua,
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
    async scan(cursor, opts) {
      const match = opts?.match ?? "*";
      const prefix = match.endsWith("*") ? match.slice(0, -1) : match;
      const all = [...data.keys()].filter((k) =>
        match.endsWith("*") ? k.startsWith(prefix) : k === match,
      );
      // Single-page fake SCAN.
      if (cursor !== "0") return ["0", []];
      return ["0", all];
    },
    async eval(script, numkeys, ...keysAndArgs) {
      const keys = keysAndArgs.slice(0, numkeys);
      const args = keysAndArgs.slice(numkeys);
      const run = evalChain.then(() => lua.eval(script, keys, args));
      evalChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

/** Protocol-named redis driver. */
export const redisDriver: KvDriver = {
  id: "redis",
  facet: "kv",
  open: openRedisKv,
};
