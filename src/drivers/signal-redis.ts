/**
 * `redis` signal driver — throughput path with internal outbox relay.
 *
 * Emit still enrols in a transactional outbox (semantics never regress).
 * After commit, a relay pushes to Redis Streams (`once`) or pub/sub
 * (`broadcast` / `live`). Consumer delivery is driven from the outbox so
 * exactly-once / fan-out physics stay correct under `drain()`.
 *
 * Production bind: {@link createBunSignalRedisClient} (typed `publish` /
 * `subscribe`; Streams via `send` — Bun 1.3.14 has no typed `xadd` yet).
 */

import { createSignalEngine } from "./signal-engine.ts";
import type {
  SignalBus,
  SignalDriver,
  SignalOpenOptions,
  SignalRedisClientLike,
} from "./signal-types.ts";

/**
 * Bind {@link Bun.RedisClient} to {@link SignalRedisClientLike}.
 *
 * Streams (`XADD` / `XGROUP` / `XREADGROUP` / `XACK`) use `send` because
 * Bun 1.3.14 still lacks typed stream helpers — that is a Bun limitation.
 * Pub/sub uses typed `publish` / `subscribe` (gap closed vs earlier fake-only).
 *
 * @param url - Optional Redis URL
 */
export function createBunSignalRedisClient(url?: string): SignalRedisClientLike {
  const redis = url !== undefined ? new Bun.RedisClient(url) : Bun.redis;
  /** Subscribe blocks a connection — keep a dedicated client. */
  let sub: InstanceType<typeof Bun.RedisClient> | undefined;

  function subClient(): InstanceType<typeof Bun.RedisClient> {
    if (!sub) {
      sub = url !== undefined ? new Bun.RedisClient(url) : new Bun.RedisClient();
    }
    return sub;
  }

  return {
    async xadd(key, id, fields) {
      const args: string[] = [key, id];
      for (const [k, v] of Object.entries(fields)) {
        args.push(k, v);
      }
      return String(await redis.send("XADD", args));
    },
    async xgroupCreate(key, group, id, opts) {
      const args = ["CREATE", key, group, id];
      if (opts?.mkstream) args.push("MKSTREAM");
      try {
        await redis.send("XGROUP", args);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/BUSYGROUP/i.test(msg)) throw err;
      }
    },
    async xreadgroup(group, consumer, key, count) {
      const reply = await redis.send("XREADGROUP", [
        "GROUP",
        group,
        consumer,
        "COUNT",
        String(count),
        "STREAMS",
        key,
        ">",
      ]);
      return parseXreadgroupReply(reply);
    },
    async xack(key, group, id) {
      return Number(await redis.send("XACK", [key, group, id]));
    },
    async publish(channel, message) {
      return redis.publish(channel, message);
    },
    async subscribe(channel, listener) {
      const client = subClient();
      await client.subscribe(channel, (message) => {
        listener(message);
      });
      return () => {
        void client.unsubscribe(channel);
      };
    },
  };
}

/**
 * Parse Redis `XREADGROUP` nested-array reply into field maps.
 *
 * @param reply - Raw `send` result
 */
export function parseXreadgroupReply(
  reply: unknown,
): Array<{ id: string; fields: Record<string, string> }> {
  if (reply == null || !Array.isArray(reply)) return [];
  const out: Array<{ id: string; fields: Record<string, string> }> = [];
  for (const stream of reply) {
    if (!Array.isArray(stream) || stream.length < 2) continue;
    const entries = stream[1];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const id = String(entry[0]);
      const flat = entry[1];
      const fields: Record<string, string> = {};
      if (Array.isArray(flat)) {
        for (let i = 0; i + 1 < flat.length; i += 2) {
          fields[String(flat[i])] = String(flat[i + 1]);
        }
      }
      out.push({ id, fields });
    }
  }
  return out;
}

/**
 * In-memory redis-protocol fake for signal streams + pub/sub.
 */
export function createSignalRedisFake(): SignalRedisClientLike & {
  readonly streams: Map<string, Array<{ id: string; fields: Record<string, string> }>>;
  readonly published: Array<{ channel: string; message: string }>;
} {
  const streams = new Map<string, Array<{ id: string; fields: Record<string, string> }>>();
  const groups = new Map<string, Set<string>>();
  const claimed = new Map<string, Set<string>>();
  const subs = new Map<string, Set<(message: string) => void>>();
  const published: Array<{ channel: string; message: string }> = [];
  let seq = 0;

  return {
    streams,
    published,
    async xadd(key, id, fields) {
      let list = streams.get(key);
      if (!list) {
        list = [];
        streams.set(key, list);
      }
      const realId = id === "*" ? `${Date.now()}-${seq++}` : id;
      list.push({ id: realId, fields: { ...fields } });
      return realId;
    },
    async xgroupCreate(key, group, _id, opts) {
      if (opts?.mkstream && !streams.has(key)) streams.set(key, []);
      const gkey = `${key}::${group}`;
      if (!groups.has(gkey)) groups.set(gkey, new Set());
      if (!claimed.has(gkey)) claimed.set(gkey, new Set());
    },
    async xreadgroup(group, consumer, key, count) {
      const gkey = `${key}::${group}`;
      if (!groups.has(gkey)) {
        await this.xgroupCreate(key, group, "0", { mkstream: true });
      }
      const seen = claimed.get(gkey)!;
      const list = streams.get(key) ?? [];
      const out: Array<{ id: string; fields: Record<string, string> }> = [];
      for (const entry of list) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        out.push({
          id: entry.id,
          fields: { ...entry.fields, _consumer: consumer },
        });
        if (out.length >= count) break;
      }
      return out;
    },
    async xack() {
      return 1;
    },
    async publish(channel, message) {
      published.push({ channel, message });
      const set = subs.get(channel);
      if (!set) return 0;
      for (const fn of set) fn(message);
      return set.size;
    },
    async subscribe(channel, listener) {
      let set = subs.get(channel);
      if (!set) {
        set = new Set();
        subs.set(channel, set);
      }
      set.add(listener);
      return () => {
        set!.delete(listener);
      };
    },
  };
}

/**
 * Open a redis signal bus (outbox + relay).
 *
 * @param options - Declarations / redis client / durable outbox path
 */
export async function openRedisSignal(options: SignalOpenOptions): Promise<SignalBus> {
  // Same DI shape as postgres/redis/s3: inject a client in tests; production
  // binds Bun.redis (Streams via send until Bun ships typed xadd).
  const redis = options.redis ?? createBunSignalRedisClient();
  const outbox = await createSignalEngine("redis", options);

  async function relayToRedis(signal: string, payload: unknown): Promise<void> {
    const decl = options.signals.get(signal);
    if (!decl) return;
    const body = JSON.stringify(payload ?? null);
    if (decl.delivery === "once") {
      const key = `oke:signal:${signal}`;
      await redis.xgroupCreate(key, "oke", "0", { mkstream: true });
      await redis.xadd(key, "*", { payload: body, signal });
    } else if (decl.delivery === "broadcast") {
      await redis.publish(`oke:signal:bcast:${signal}`, body);
    } else {
      await redis.publish(`oke:signal:live:${signal}`, body);
    }
  }

  return {
    driverId: "redis",
    async emit(signal, payload, options) {
      await outbox.emit(signal, payload, options);
      await relayToRedis(signal, payload);
    },
    async begin() {
      const staged: Array<{ signal: string; payload: unknown }> = [];
      const tx = await outbox.begin();
      return {
        write: (k, v) => tx.write(k, v),
        async emit(signal, payload, options) {
          staged.push({ signal, payload });
          await tx.emit(signal, payload, options);
        },
        async commit() {
          await tx.commit();
          for (const e of staged) await relayToRedis(e.signal, e.payload);
        },
        rollback: () => tx.rollback(),
      };
    },
    subscribe: (signal, subscriberId, handler) => outbox.subscribe(signal, subscriberId, handler),
    live: (signal, handler) => outbox.live(signal, handler),
    drain: () => outbox.drain(),
    deadLetters: (s) => outbox.deadLetters(s),
    inspect: (s) => outbox.inspect(s),
    replay: (opts) => outbox.replay(opts),
    discard: (opts) => outbox.discard(opts),
    getWrite: (k) => outbox.getWrite(k),
    close: () => outbox.close(),
  };
}

/** Protocol-named redis signal driver. */
export const redisSignalDriver: SignalDriver = {
  id: "redis",
  open: openRedisSignal,
};
