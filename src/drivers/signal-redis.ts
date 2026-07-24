/**
 * `redis` signal driver — throughput path with internal outbox relay.
 *
 * Emit still enrols in a transactional outbox (semantics never regress).
 * After commit, a relay pushes to Redis Streams (`once`) or pub/sub
 * (`broadcast` / `live`). Consumer delivery is driven from the outbox so
 * exactly-once / fan-out physics stay correct under `drain()`.
 */

import { createSignalEngine } from "./signal-engine.ts";
import type {
  SignalBus,
  SignalDriver,
  SignalOpenOptions,
  SignalRedisClientLike,
} from "./signal-types.ts";

/**
 * In-memory redis-protocol fake for signal streams + pub/sub.
 */
export function createSignalRedisFake(): SignalRedisClientLike & {
  readonly streams: Map<
    string,
    Array<{ id: string; fields: Record<string, string> }>
  >;
  readonly published: Array<{ channel: string; message: string }>;
} {
  const streams = new Map<
    string,
    Array<{ id: string; fields: Record<string, string> }>
  >();
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
export async function openRedisSignal(
  options: SignalOpenOptions,
): Promise<SignalBus> {
  const redis = options.redis ?? createSignalRedisFake();
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
    async emit(signal, payload) {
      await outbox.emit(signal, payload);
      await relayToRedis(signal, payload);
    },
    async begin() {
      const staged: Array<{ signal: string; payload: unknown }> = [];
      const tx = await outbox.begin();
      return {
        write: (k, v) => tx.write(k, v),
        async emit(signal, payload) {
          staged.push({ signal, payload });
          await tx.emit(signal, payload);
        },
        async commit() {
          await tx.commit();
          for (const e of staged) await relayToRedis(e.signal, e.payload);
        },
        rollback: () => tx.rollback(),
      };
    },
    subscribe: (signal, subscriberId, handler) =>
      outbox.subscribe(signal, subscriberId, handler),
    live: (signal, handler) => outbox.live(signal, handler),
    drain: () => outbox.drain(),
    deadLetters: (s) => outbox.deadLetters(s),
    getWrite: (k) => outbox.getWrite(k),
    close: () => outbox.close(),
  };
}

/** Protocol-named redis signal driver. */
export const redisSignalDriver: SignalDriver = {
  id: "redis",
  open: openRedisSignal,
};
