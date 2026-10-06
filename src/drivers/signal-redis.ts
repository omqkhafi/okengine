/**
 * `redis` signal driver — throughput path with internal outbox relay.
 *
 * Emit still enrols in a transactional outbox (semantics never regress).
 * After commit, a relay pushes to Redis Streams (`once`) or pub/sub
 * (`broadcast` / `live`). With `compete: true`, `once` delivery is
 * `XREADGROUP` / `XACK` (pending reclaim on the next drain). Broadcast
 * and live stay on the outbox plus pub/sub.
 *
 * Production bind: {@link createBunSignalRedisClient} (typed `publish` /
 * `subscribe` / `xadd` / `xreadgroup` / `xack` / `xgroup` on Bun ≥1.4).
 */

import { createSignalEngine } from "./signal-engine.ts";
import type {
  DeadLetter,
  SignalBus,
  SignalDriver,
  SignalFailureReason,
  SignalHandler,
  SignalMessage,
  SignalOpenOptions,
  SignalRedisClientLike,
} from "./signal-types.ts";

/** Bun 1.4 typed stream methods — `@types/bun` may lag the runtime. */
interface BunRedisStreams {
  xadd(key: string, ...args: (string | number)[]): Promise<unknown>;
  xreadgroup(...args: (string | number)[]): Promise<unknown>;
  xack(key: string, group: string, id: string): Promise<unknown>;
  xgroup(subcommand: string, ...args: (string | number)[]): Promise<unknown>;
}

function typedStreams(redis: Bun.RedisClient): Bun.RedisClient & BunRedisStreams {
  return redis as Bun.RedisClient & BunRedisStreams;
}

/**
 * Bind {@link Bun.RedisClient} to {@link SignalRedisClientLike}.
 *
 * Streams use typed `xadd` / `xgroup` / `xreadgroup` / `xack` (Bun ≥1.4).
 * Pub/sub uses typed `publish` / `subscribe`.
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
      const pairs: string[] = [];
      for (const [k, v] of Object.entries(fields)) {
        pairs.push(k, v);
      }
      return String(await typedStreams(redis).xadd(key, id, ...pairs));
    },
    async xgroupCreate(key, group, id, opts) {
      const extra = opts?.mkstream ? (["MKSTREAM"] as const) : [];
      try {
        await typedStreams(redis).xgroup("CREATE", key, group, id, ...extra);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/BUSYGROUP/i.test(msg)) throw err;
      }
    },
    async xreadgroup(group, consumer, key, count) {
      try {
        await redis.send("XAUTOCLAIM", [
          key,
          group,
          consumer,
          "5000",
          "0-0",
          "COUNT",
          String(count),
        ]);
      } catch {
        /* Idle reclaim is best-effort; same-consumer pending still returns below. */
      }
      const pending = parseXreadgroupReply(
        await typedStreams(redis).xreadgroup(
          "GROUP",
          group,
          consumer,
          "COUNT",
          count,
          "STREAMS",
          key,
          "0",
        ),
      );
      if (pending.length > 0) return pending;
      const reply = await typedStreams(redis).xreadgroup(
        "GROUP",
        group,
        consumer,
        "COUNT",
        count,
        "STREAMS",
        key,
        ">",
      );
      return parseXreadgroupReply(reply);
    },
    async xack(key, group, id) {
      return Number(await typedStreams(redis).xack(key, group, id));
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
  const pending = new Map<
    string,
    Array<{ id: string; fields: Record<string, string>; consumer: string }>
  >();
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
      if (!pending.has(gkey)) pending.set(gkey, []);
    },
    async xreadgroup(group, consumer, key, count) {
      const gkey = `${key}::${group}`;
      if (!groups.has(gkey)) {
        await this.xgroupCreate(key, group, "0", { mkstream: true });
      }
      const seen = claimed.get(gkey)!;
      const held = pending.get(gkey)!;
      const list = streams.get(key) ?? [];
      const out: Array<{ id: string; fields: Record<string, string> }> = [];
      for (const entry of held) {
        if (entry.consumer !== consumer) continue;
        out.push({ id: entry.id, fields: { ...entry.fields } });
        if (out.length >= count) return out;
      }
      for (const entry of list) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        held.push({ id: entry.id, fields: { ...entry.fields }, consumer });
        out.push({ id: entry.id, fields: { ...entry.fields } });
        if (out.length >= count) return out;
      }
      for (const entry of held) {
        if (entry.consumer === consumer) continue;
        entry.consumer = consumer;
        out.push({ id: entry.id, fields: { ...entry.fields } });
        if (out.length >= count) break;
      }
      return out;
    },
    async xack(key, group, id) {
      const gkey = `${key}::${group}`;
      const held = pending.get(gkey);
      if (!held) return 0;
      const next = held.filter((entry) => entry.id !== id);
      pending.set(gkey, next);
      return next.length === held.length ? 0 : 1;
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
  const compete = options.compete === true;
  const onceHandlers = new Map<string, SignalHandler[]>();
  const streamDead: DeadLetter[] = [];
  const attemptById = new Map<string, number>();
  const now = options.now ?? (() => Date.now());

  if (compete) {
    for (const [name, decl] of options.signals) {
      if (decl.delivery !== "once") continue;
      outbox.subscribe(name, "oke-relay-ack", async () => {});
      onceHandlers.set(name, []);
    }
  }

  function streamMessage(
    name: string,
    id: string,
    payload: unknown,
    attempt: number,
  ): SignalMessage {
    const at = now();
    return {
      id,
      signal: name,
      payload,
      delivery: "once",
      attempts: attempt,
      failures: [],
      createdAt: at,
      availableAt: at,
      status: "inflight",
    };
  }

  async function drainOnceStreams(): Promise<void> {
    const group = "oke";
    const consumer = options.consumerId ?? "local";
    for (const [name, decl] of options.signals) {
      if (decl.delivery !== "once") continue;
      const key = `oke:signal:${name}`;
      await redis.xgroupCreate(key, group, "0", { mkstream: true });
      const rows = await redis.xreadgroup(group, consumer, key, 32);
      for (const row of rows) {
        const handler = onceHandlers.get(name)?.[0];
        let payload: unknown = null;
        try {
          payload = JSON.parse(row.fields.payload ?? "null");
        } catch {
          payload = null;
        }
        const attempt = (attemptById.get(row.id) ?? 0) + 1;
        attemptById.set(row.id, attempt);
        if (!handler) continue;
        try {
          await handler(streamMessage(name, row.id, payload, attempt));
          await redis.xack(key, group, row.id);
          attemptById.delete(row.id);
        } catch (err) {
          const retries = decl.retries ?? 3;
          if (attempt > retries) {
            const failure: SignalFailureReason = {
              code: "handler_error",
              message: err instanceof Error ? err.message : String(err),
              at: now(),
              attempt,
            };
            if (decl.deadLetter) {
              const at = now();
              streamDead.push({
                id: row.id,
                signal: name,
                payload,
                delivery: "once",
                attempts: attempt,
                failures: [failure],
                createdAt: at,
                availableAt: at,
                status: "dead",
              });
            }
            await redis.xack(key, group, row.id);
            attemptById.delete(row.id);
          }
        }
      }
    }
  }

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
    subscribe(signal, subscriberId, handler) {
      if (compete && options.signals.get(signal)?.delivery === "once") {
        const list = onceHandlers.get(signal) ?? [];
        list.push(handler);
        onceHandlers.set(signal, list);
        return Promise.resolve(() => {
          const next = (onceHandlers.get(signal) ?? []).filter((h) => h !== handler);
          onceHandlers.set(signal, next);
        });
      }
      return outbox.subscribe(signal, subscriberId, handler);
    },
    live: (signal, opts) => outbox.live(signal, opts),
    checkLiveResume: (signal, afterId) => outbox.checkLiveResume(signal, afterId),
    async drain() {
      if (compete) await drainOnceStreams();
      await outbox.drain();
    },
    async deadLetters(s) {
      const local = streamDead.filter((entry) => entry.signal === s);
      const rest = await outbox.deadLetters(s);
      return [...rest, ...local];
    },
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
