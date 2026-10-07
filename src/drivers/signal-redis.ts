/**
 * `redis` signal driver — throughput path with internal outbox relay.
 *
 * Emit still enrols in a transactional outbox (semantics never regress).
 * After commit, a relay pushes to Redis Streams (`once`) or pub/sub
 * (`broadcast` / `live`). With `compete: true`, `once` delivery is
 * `XREADGROUP` / `XACK`, with `XAUTOCLAIM` reclaim on the same read.
 * Broadcast and live stay on the outbox plus pub/sub.
 *
 * Production bind: {@link createBunSignalRedisClient} (typed `publish` /
 * `subscribe` / `xadd` / `xreadgroup` / `xack` / `xgroup` on Bun ≥1.4).
 */

import { createSignalEngine } from "./signal-engine.ts";
import { createLiveIterable } from "./signal-live-iter.ts";
import type {
  DeadLetter,
  LiveEvent,
  SignalBus,
  SignalDriver,
  SignalFailureReason,
  SignalHandler,
  SignalMessage,
  SignalOpenOptions,
  SignalRedisClientLike,
} from "./signal-types.ts";

/**
 * Minimum idle time before `XAUTOCLAIM` steals a pending `once` entry.
 * A handler that is still running refreshes its lease about every third of this window.
 */
export const SIGNAL_REDIS_MIN_IDLE_MS = 30_000;

/** Drop group consumers idle at least this long when their PEL is empty. */
const CONSUMER_IDLE_RETENTION_MS = 86_400_000;

const STREAM_GROUP = "oke";

/** Bun 1.4 typed stream methods — `@types/bun` may lag the runtime. */
interface BunRedisStreams {
  xadd(key: string, ...args: (string | number)[]): Promise<unknown>;
  xreadgroup(...args: (string | number)[]): Promise<unknown>;
  xautoclaim(
    key: string,
    group: string,
    consumer: string,
    minIdleTime: number,
    start: string,
    ...options: (string | number)[]
  ): Promise<unknown>;
  xclaim(
    key: string,
    group: string,
    consumer: string,
    minIdleTime: number,
    id: string,
    ...rest: (string | number)[]
  ): Promise<unknown>;
  xack(key: string, group: string, id: string): Promise<unknown>;
  xgroup(subcommand: string, ...args: (string | number)[]): Promise<unknown>;
  xrange(key: string, start: string, end: string): Promise<unknown>;
  xinfo(subcommand: string, ...args: (string | number)[]): Promise<unknown>;
  hincrby(key: string, field: string, increment: number): Promise<number>;
  hdel(key: string, field: string): Promise<number>;
}

interface StreamEntry {
  id: string;
  fields: Record<string, string>;
}

/** One row from `XINFO CONSUMERS`. */
interface RedisConsumerInfo {
  readonly name: string;
  readonly pending: number;
  readonly idle: number;
}

/**
 * Extra Redis commands the signal bus uses on top of {@link SignalRedisClientLike}.
 * Implemented by {@link createBunSignalRedisClient} and {@link createSignalRedisFake}.
 */
interface SignalRedisWire extends SignalRedisClientLike {
  xclaim(
    key: string,
    group: string,
    consumer: string,
    minIdleMs: number,
    ids: readonly string[],
  ): Promise<void>;
  hincrby(key: string, field: string, increment: number): Promise<number>;
  hdel(key: string, field: string): Promise<number>;
  xrange(key: string): Promise<StreamEntry[]>;
  xinfoConsumers(key: string, group: string): Promise<RedisConsumerInfo[]>;
  xgroupDelConsumer(key: string, group: string, consumer: string): Promise<void>;
  close(): Promise<void>;
}

interface InflightBatch {
  readonly key: string;
  readonly group: string;
  readonly consumer: string;
  readonly ids: Set<string>;
}

interface PendingEntry {
  id: string;
  fields: Record<string, string>;
  consumer: string;
  claimedAt: number;
}

/** Pub/sub body published for `broadcast` / `live`. */
interface SignalPubEnvelope {
  readonly __oke_env: 1;
  readonly id: string;
  readonly origin: string;
  readonly payload: unknown;
}

const inflightByClient = new WeakMap<object, Map<string, InflightBatch>>();
const heartbeats = new WeakMap<object, Set<ReturnType<typeof setInterval>>>();

function bunStreams(redis: Bun.RedisClient): BunRedisStreams {
  return redis as unknown as BunRedisStreams;
}

function asWire(client: SignalRedisClientLike): SignalRedisWire {
  return client as SignalRedisWire;
}

function streamKey(name: string): string {
  return `oke:signal:${name}`;
}

function attemptsKey(name: string): string {
  return `oke:signal:attempts:${name}`;
}

function deadKey(name: string): string {
  return `oke:signal:dead:${name}`;
}

function bcastChannel(name: string): string {
  return `oke:signal:bcast:${name}`;
}

function liveChannel(name: string): string {
  return `oke:signal:live:${name}`;
}

function inflightSlot(key: string, consumer: string): string {
  return `${key}\0${consumer}`;
}

function markInflight(
  client: object,
  key: string,
  group: string,
  consumer: string,
  id: string,
): void {
  let batches = inflightByClient.get(client);
  if (!batches) {
    batches = new Map();
    inflightByClient.set(client, batches);
  }
  const slot = inflightSlot(key, consumer);
  let batch = batches.get(slot);
  if (!batch) {
    batch = { key, group, consumer, ids: new Set() };
    batches.set(slot, batch);
  }
  batch.ids.add(id);
}

function unmarkInflight(client: object, key: string, consumer: string, id: string): void {
  inflightByClient.get(client)?.get(inflightSlot(key, consumer))?.ids.delete(id);
}

function isInflight(client: object, key: string, consumer: string, id: string): boolean {
  return inflightByClient.get(client)?.get(inflightSlot(key, consumer))?.ids.has(id) ?? false;
}

/**
 * `XCLAIM ... JUSTID` for every id this process is still handling.
 *
 * @param client - Redis client that owns the in-flight set
 */
async function refreshInflight(client: object): Promise<void> {
  const batches = inflightByClient.get(client);
  if (!batches) return;
  const ops = client as SignalRedisWire;
  for (const batch of batches.values()) {
    if (batch.ids.size === 0) continue;
    try {
      await ops.xclaim(batch.key, batch.group, batch.consumer, 0, [...batch.ids]);
    } catch {
      /* Lease refresh is best-effort. */
    }
  }
}

/**
 * Start the idle-reset timer for one bus. Call the returned function on shutdown.
 *
 * @param client - Redis client whose in-flight ids should be refreshed
 */
function retainHeartbeat(client: object): () => void {
  const timer = setInterval(
    () => {
      void refreshInflight(client);
    },
    Math.floor(SIGNAL_REDIS_MIN_IDLE_MS / 3),
  );
  if (typeof timer.unref === "function") timer.unref();
  let timers = heartbeats.get(client);
  if (!timers) {
    timers = new Set();
    heartbeats.set(client, timers);
  }
  const bucket = timers;
  bucket.add(timer);
  return () => {
    clearInterval(timer);
    bucket.delete(timer);
  };
}

function clearHeartbeats(client: object): void {
  const timers = heartbeats.get(client);
  if (!timers) return;
  for (const timer of timers) clearInterval(timer);
  timers.clear();
}

function parseFields(flat: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!Array.isArray(flat)) return fields;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const key = flat[i];
    const value = flat[i + 1];
    if (key === undefined || value === undefined) continue;
    fields[String(key)] = String(value);
  }
  return fields;
}

function parseEntry(entry: unknown): StreamEntry | undefined {
  if (!Array.isArray(entry) || entry.length < 2) return undefined;
  const id = entry[0];
  if (id === undefined || typeof id === "object") return undefined;
  return { id: String(id), fields: parseFields(entry[1]) };
}

function parseEntryList(entries: unknown): StreamEntry[] {
  if (!Array.isArray(entries)) return [];
  const out: StreamEntry[] = [];
  for (const entry of entries) {
    const parsed = parseEntry(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** True when `value` is a list of stream entries (`[id, fields][]`), including empty. */
function isEntryList(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  return Array.isArray(value[0]);
}

function mergeEntries(
  groups: readonly (readonly StreamEntry[])[],
  skip: (id: string) => boolean,
  count: number,
): StreamEntry[] {
  const out: StreamEntry[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const entry of group) {
      if (seen.has(entry.id) || skip(entry.id)) continue;
      seen.add(entry.id);
      out.push(entry);
      if (out.length >= count) return out;
    }
  }
  return out;
}

/**
 * Parse Redis `XREADGROUP` and `XAUTOCLAIM` replies into field maps.
 *
 * Bun returns a stream map `{ "<stream>": [[id, [field, value, ...]], ...] }`
 * for both commands. RESP nested arrays are accepted too: `XREADGROUP`
 * `[[stream, entries], ...]` and `XAUTOCLAIM` `[cursor, entries, deletedIds]`.
 *
 * @param reply - Raw command result
 */
export function parseXreadgroupReply(reply: unknown): StreamEntry[] {
  if (reply == null) return [];
  if (typeof reply === "object" && !Array.isArray(reply)) {
    const out: StreamEntry[] = [];
    for (const entries of Object.values(reply)) {
      out.push(...parseEntryList(entries));
    }
    return out;
  }
  if (!Array.isArray(reply) || reply.length === 0) return [];

  // XAUTOCLAIM: [nextCursor, [[id, fields], ...], deleted?]
  if (typeof reply[0] === "string") return parseEntryList(reply[1]);

  const head = reply[0];
  if (!Array.isArray(head) || head.length < 2) return [];
  // Bare [[id, [field, value, ...]], ...] — the second slot is a field list, not entries.
  if (!isEntryList(head[1])) return parseEntryList(reply);

  const out: StreamEntry[] = [];
  for (const stream of reply) {
    if (!Array.isArray(stream) || stream.length < 2) continue;
    out.push(...parseEntryList(stream[1]));
  }
  return out;
}

function parseXinfoConsumers(reply: unknown): RedisConsumerInfo[] {
  if (!Array.isArray(reply)) return [];
  const out: RedisConsumerInfo[] = [];
  for (const row of reply) {
    if (row !== null && typeof row === "object" && !Array.isArray(row)) {
      const rec = row as Record<string, unknown>;
      if (typeof rec.name !== "string") continue;
      out.push({
        name: rec.name,
        pending: Number(rec.pending ?? 0),
        idle: Number(rec.idle ?? 0),
      });
      continue;
    }
    if (!Array.isArray(row)) continue;
    const fields: Record<string, string> = {};
    for (let i = 0; i + 1 < row.length; i += 2) {
      const key = row[i];
      const value = row[i + 1];
      if (key === undefined || value === undefined) continue;
      fields[String(key)] = String(value);
    }
    const name = fields.name;
    if (name === undefined) continue;
    out.push({
      name,
      pending: Number(fields.pending ?? 0),
      idle: Number(fields.idle ?? 0),
    });
  }
  return out;
}

function isPubEnvelope(value: unknown): value is SignalPubEnvelope {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value) && "__oke_env" in value
  );
}

/**
 * Decode a pub/sub body.
 *
 * Own-origin envelopes are skipped (the local outbox already delivered them).
 * A body with no `__oke_env` is a legacy raw payload.
 *
 * @param raw - Published string
 * @param origin - This instance id
 */
function decodePublished(
  raw: string,
  origin: string,
): { id: string; payload: unknown } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (isPubEnvelope(parsed)) {
    if (parsed.origin === origin) return undefined;
    const id =
      typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : crypto.randomUUID();
    return { id, payload: parsed.payload ?? null };
  }
  return { id: crypto.randomUUID(), payload: parsed };
}

function pubBody(id: string, origin: string, payload: unknown): string {
  const envelope: SignalPubEnvelope = {
    __oke_env: 1,
    id,
    origin,
    payload: payload ?? null,
  };
  return JSON.stringify(envelope);
}

function parseFailures(raw: string | undefined): SignalFailureReason[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: SignalFailureReason[] = [];
    for (const item of parsed) {
      if (item === null || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.code !== "string" || typeof rec.message !== "string") continue;
      if (typeof rec.at !== "number" || typeof rec.attempt !== "number") continue;
      out.push({ code: rec.code, message: rec.message, at: rec.at, attempt: rec.attempt });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Bind {@link Bun.RedisClient} to {@link SignalRedisClientLike}.
 *
 * Streams use typed `xadd` / `xgroup` / `xreadgroup` / `xautoclaim` / `xack`
 * (Bun ≥1.4). Pub/sub uses typed `publish` / `subscribe`. `close` stops the
 * idle-reset timer and closes connections this helper opened.
 *
 * @param url - Optional Redis URL. Omit to use the shared `Bun.redis` client.
 */
export function createBunSignalRedisClient(url?: string): SignalRedisClientLike {
  const dedicated = url !== undefined;
  const redis = dedicated ? new Bun.RedisClient(url) : Bun.redis;
  /** Subscribe blocks a connection — keep a dedicated client. */
  let sub: InstanceType<typeof Bun.RedisClient> | undefined;

  function subClient(): InstanceType<typeof Bun.RedisClient> {
    if (!sub) {
      sub = dedicated ? new Bun.RedisClient(url) : new Bun.RedisClient();
    }
    return sub;
  }

  const streams = () => bunStreams(redis);

  const api = {
    async xadd(key: string, id: string, fields: Record<string, string>): Promise<string> {
      const pairs: string[] = [];
      for (const [k, v] of Object.entries(fields)) {
        pairs.push(k, v);
      }
      return String(await streams().xadd(key, id, ...pairs));
    },
    async xgroupCreate(
      key: string,
      group: string,
      id: string,
      opts?: { mkstream?: boolean },
    ): Promise<void> {
      const extra = opts?.mkstream ? (["MKSTREAM"] as const) : [];
      try {
        await streams().xgroup("CREATE", key, group, id, ...extra);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/BUSYGROUP/i.test(msg)) throw err;
      }
    },
    async xreadgroup(
      group: string,
      consumer: string,
      key: string,
      count: number,
    ): Promise<StreamEntry[]> {
      const skip = (id: string) => isInflight(api, key, consumer, id);
      let claimed: StreamEntry[] = [];
      try {
        const reply = await streams().xautoclaim(
          key,
          group,
          consumer,
          SIGNAL_REDIS_MIN_IDLE_MS,
          "0-0",
          "COUNT",
          count,
        );
        claimed = parseXreadgroupReply(reply);
      } catch {
        /* Idle reclaim is best-effort; same-consumer pending still returns below. */
      }
      const pending = parseXreadgroupReply(
        await streams().xreadgroup("GROUP", group, consumer, "COUNT", count, "STREAMS", key, "0"),
      );
      const owned = mergeEntries([claimed, pending], skip, count);
      if (owned.length > 0) return owned;
      const fresh = parseXreadgroupReply(
        await streams().xreadgroup("GROUP", group, consumer, "COUNT", count, "STREAMS", key, ">"),
      );
      return mergeEntries([fresh], skip, count);
    },
    async xack(key: string, group: string, id: string): Promise<number> {
      return Number(await streams().xack(key, group, id));
    },
    async xclaim(
      key: string,
      group: string,
      consumer: string,
      minIdleMs: number,
      ids: readonly string[],
    ): Promise<void> {
      const first = ids[0];
      if (first === undefined) return;
      await streams().xclaim(key, group, consumer, minIdleMs, first, ...ids.slice(1), "JUSTID");
    },
    async hincrby(key: string, field: string, increment: number): Promise<number> {
      return Number(await streams().hincrby(key, field, increment));
    },
    async hdel(key: string, field: string): Promise<number> {
      return Number(await streams().hdel(key, field));
    },
    async xrange(key: string): Promise<StreamEntry[]> {
      return parseEntryList(await streams().xrange(key, "-", "+"));
    },
    async xinfoConsumers(key: string, group: string): Promise<RedisConsumerInfo[]> {
      try {
        return parseXinfoConsumers(await streams().xinfo("CONSUMERS", key, group));
      } catch {
        return [];
      }
    },
    async xgroupDelConsumer(key: string, group: string, consumer: string): Promise<void> {
      await streams().xgroup("DELCONSUMER", key, group, consumer);
    },
    async publish(channel: string, message: string): Promise<number> {
      return redis.publish(channel, message);
    },
    async subscribe(channel: string, listener: (message: string) => void): Promise<() => void> {
      const client = subClient();
      await client.subscribe(channel, (message) => {
        listener(message);
      });
      return () => {
        void client.unsubscribe(channel);
      };
    },
    async close(): Promise<void> {
      clearHeartbeats(api);
      sub?.close();
      sub = undefined;
      if (dedicated) redis.close();
    },
  };

  if (dedicated) {
    const previousOnClose = redis.onclose;
    redis.onclose = function (this: Bun.RedisClient, error: Error): void {
      clearHeartbeats(api);
      previousOnClose?.call(this, error);
    };
  }

  return api;
}

/**
 * In-memory redis-protocol fake for signal streams + pub/sub.
 *
 * Pending entries carry a claim clock (`now`, default `Date.now`). Another
 * consumer reclaims one only after {@link SIGNAL_REDIS_MIN_IDLE_MS}.
 * `flushIdle` runs the same batched `XCLAIM ... JUSTID` the idle-reset timer uses.
 *
 * @param options - Optional clock for idle / reclaim tests
 */
export function createSignalRedisFake(options?: { now?: () => number }): SignalRedisClientLike & {
  readonly streams: Map<string, Array<{ id: string; fields: Record<string, string> }>>;
  readonly published: Array<{ channel: string; message: string }>;
  flushIdle(): Promise<void>;
} {
  const clock = options?.now ?? (() => Date.now());
  const streams = new Map<string, Array<{ id: string; fields: Record<string, string> }>>();
  const groups = new Map<string, Set<string>>();
  const claimed = new Map<string, Set<string>>();
  const pending = new Map<string, PendingEntry[]>();
  const consumerSeen = new Map<string, Map<string, number>>();
  const hashes = new Map<string, Map<string, number>>();
  const subs = new Map<string, Set<(message: string) => void | Promise<void>>>();
  const published: Array<{ channel: string; message: string }> = [];
  let seq = 0;

  function touchConsumer(gkey: string, consumer: string): void {
    let names = consumerSeen.get(gkey);
    if (!names) {
      names = new Map();
      consumerSeen.set(gkey, names);
    }
    names.set(consumer, clock());
  }

  const api = {
    streams,
    published,
    async flushIdle(): Promise<void> {
      await refreshInflight(api);
    },
    async xadd(key: string, id: string, fields: Record<string, string>): Promise<string> {
      let list = streams.get(key);
      if (!list) {
        list = [];
        streams.set(key, list);
      }
      const realId = id === "*" ? `${Date.now()}-${seq++}` : id;
      list.push({ id: realId, fields: { ...fields } });
      return realId;
    },
    async xgroupCreate(
      key: string,
      group: string,
      _id: string,
      opts?: { mkstream?: boolean },
    ): Promise<void> {
      if (opts?.mkstream && !streams.has(key)) streams.set(key, []);
      const gkey = `${key}::${group}`;
      if (!groups.has(gkey)) groups.set(gkey, new Set());
      if (!claimed.has(gkey)) claimed.set(gkey, new Set());
      if (!pending.has(gkey)) pending.set(gkey, []);
    },
    async xreadgroup(
      group: string,
      consumer: string,
      key: string,
      count: number,
    ): Promise<StreamEntry[]> {
      const gkey = `${key}::${group}`;
      if (!groups.has(gkey)) {
        await api.xgroupCreate(key, group, "0", { mkstream: true });
      }
      touchConsumer(gkey, consumer);
      const seen = claimed.get(gkey);
      const held = pending.get(gkey);
      if (!seen || !held) return [];
      const list = streams.get(key) ?? [];
      const t = clock();
      const out: StreamEntry[] = [];

      const push = (entry: PendingEntry): boolean => {
        if (isInflight(api, key, consumer, entry.id)) return false;
        if (out.some((row) => row.id === entry.id)) return false;
        out.push({ id: entry.id, fields: { ...entry.fields } });
        return out.length >= count;
      };

      let full = false;
      for (const entry of held) {
        if (entry.consumer === consumer) continue;
        if (t - entry.claimedAt < SIGNAL_REDIS_MIN_IDLE_MS) continue;
        entry.consumer = consumer;
        entry.claimedAt = t;
        if (push(entry)) {
          full = true;
          break;
        }
      }
      if (!full) {
        for (const entry of held) {
          if (entry.consumer !== consumer) continue;
          if (push(entry)) {
            full = true;
            break;
          }
        }
      }
      if (out.length > 0) return out;

      for (const entry of list) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        const claimedEntry: PendingEntry = {
          id: entry.id,
          fields: { ...entry.fields },
          consumer,
          claimedAt: t,
        };
        held.push(claimedEntry);
        if (push(claimedEntry)) break;
      }
      return out;
    },
    async xack(key: string, group: string, id: string): Promise<number> {
      const gkey = `${key}::${group}`;
      const held = pending.get(gkey);
      if (!held) return 0;
      const next = held.filter((entry) => entry.id !== id);
      pending.set(gkey, next);
      return next.length === held.length ? 0 : 1;
    },
    async xclaim(
      key: string,
      group: string,
      consumer: string,
      minIdleMs: number,
      ids: readonly string[],
    ): Promise<void> {
      const held = pending.get(`${key}::${group}`);
      if (!held || ids.length === 0) return;
      const want = new Set(ids);
      const t = clock();
      for (const entry of held) {
        if (!want.has(entry.id)) continue;
        if (t - entry.claimedAt < minIdleMs) continue;
        entry.consumer = consumer;
        entry.claimedAt = t;
      }
    },
    async hincrby(key: string, field: string, increment: number): Promise<number> {
      let hash = hashes.get(key);
      if (!hash) {
        hash = new Map();
        hashes.set(key, hash);
      }
      const next = (hash.get(field) ?? 0) + increment;
      hash.set(field, next);
      return next;
    },
    async hdel(key: string, field: string): Promise<number> {
      const hash = hashes.get(key);
      if (!hash || !hash.has(field)) return 0;
      hash.delete(field);
      return 1;
    },
    async xrange(key: string): Promise<StreamEntry[]> {
      const list = streams.get(key) ?? [];
      return list.map((entry) => ({ id: entry.id, fields: { ...entry.fields } }));
    },
    async xinfoConsumers(key: string, group: string): Promise<RedisConsumerInfo[]> {
      const gkey = `${key}::${group}`;
      const names = consumerSeen.get(gkey);
      if (!names) return [];
      const held = pending.get(gkey) ?? [];
      const t = clock();
      const out: RedisConsumerInfo[] = [];
      for (const [name, seenAt] of names) {
        let pendingCount = 0;
        for (const entry of held) {
          if (entry.consumer === name) pendingCount += 1;
        }
        out.push({ name, pending: pendingCount, idle: Math.max(0, t - seenAt) });
      }
      return out;
    },
    async xgroupDelConsumer(key: string, group: string, consumer: string): Promise<void> {
      const gkey = `${key}::${group}`;
      consumerSeen.get(gkey)?.delete(consumer);
      const held = pending.get(gkey);
      if (!held) return;
      pending.set(
        gkey,
        held.filter((entry) => entry.consumer !== consumer),
      );
    },
    async publish(channel: string, message: string): Promise<number> {
      published.push({ channel, message });
      const set = subs.get(channel);
      if (!set) return 0;
      const listeners: Array<(message: string) => void | Promise<void>> = [];
      for (const fn of set) listeners.push(fn);
      for (const fn of listeners) await fn(message);
      return set.size;
    },
    async subscribe(channel: string, listener: (message: string) => void): Promise<() => void> {
      let set = subs.get(channel);
      if (!set) {
        set = new Set();
        subs.set(channel, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    async close(): Promise<void> {
      clearHeartbeats(api);
    },
  };

  return api;
}

/**
 * Open a redis signal bus (outbox + relay).
 *
 * @param options - Declarations / redis client / durable outbox path
 */
export async function openRedisSignal(options: SignalOpenOptions): Promise<SignalBus> {
  // Same DI shape as postgres/redis/s3: inject a client in tests; production
  // binds Bun.redis (Streams via the typed client).
  const redis = options.redis ?? createBunSignalRedisClient();
  const wire = asWire(redis);
  const ownsClient = options.redis === undefined;
  const outbox = await createSignalEngine("redis", options);
  const compete = options.compete === true;
  const onceHandlers = new Map<string, SignalHandler[]>();
  const remoteHandlers = new Map<string, SignalHandler[]>();
  const liveEmitters = new Map<string, Set<(event: LiveEvent) => void>>();
  const now = options.now ?? (() => Date.now());
  const origin = options.consumerId ?? crypto.randomUUID();
  const channelUnsubs: Array<() => void | Promise<void>> = [];

  if (compete) {
    for (const [name, decl] of options.signals) {
      if (decl.delivery !== "once") continue;
      await outbox.subscribe(name, "oke-relay-ack", async () => {});
    }
  }

  function liveSet(name: string): Set<(event: LiveEvent) => void> {
    let set = liveEmitters.get(name);
    if (!set) {
      set = new Set();
      liveEmitters.set(name, set);
    }
    return set;
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

  async function deliverPub(
    signalName: string,
    delivery: "broadcast" | "live",
    raw: string,
  ): Promise<void> {
    const incoming = decodePublished(raw, origin);
    if (!incoming) return;
    if (delivery === "live") {
      const emitters = liveEmitters.get(signalName);
      if (!emitters) return;
      for (const emit of emitters) {
        emit({ id: incoming.id, payload: incoming.payload });
      }
      return;
    }
    const at = now();
    const handlers = remoteHandlers.get(signalName) ?? [];
    for (const handler of handlers) {
      try {
        await handler({
          id: incoming.id,
          signal: signalName,
          payload: incoming.payload,
          delivery: "broadcast",
          attempts: 1,
          failures: [],
          createdAt: at,
          availableAt: at,
          status: "inflight",
        });
      } catch {
        /* One subscriber's error must not drop the relay. */
      }
    }
  }

  for (const [name, decl] of options.signals) {
    if (decl.delivery === "broadcast") {
      channelUnsubs.push(
        await redis.subscribe(bcastChannel(name), (message) => {
          return deliverPub(name, "broadcast", message);
        }),
      );
    } else if (decl.delivery === "live") {
      channelUnsubs.push(
        await redis.subscribe(liveChannel(name), (message) => {
          return deliverPub(name, "live", message);
        }),
      );
    }
  }

  const stopHeartbeat = retainHeartbeat(redis);

  async function reapIdleConsumers(key: string, selfName: string): Promise<void> {
    try {
      const rows = await wire.xinfoConsumers(key, STREAM_GROUP);
      for (const row of rows) {
        if (row.name === selfName) continue;
        if (row.pending !== 0) continue;
        if (row.idle < CONSUMER_IDLE_RETENTION_MS) continue;
        await wire.xgroupDelConsumer(key, STREAM_GROUP, row.name);
      }
    } catch {
      /* Consumer cleanup is best-effort. */
    }
  }

  async function readDeadLetters(name: string): Promise<DeadLetter[]> {
    const rows = await wire.xrange(deadKey(name));
    const out: DeadLetter[] = [];
    for (const row of rows) {
      let payload: unknown = null;
      try {
        payload = JSON.parse(row.fields.payload ?? "null");
      } catch {
        payload = null;
      }
      const at = Number(row.fields.createdAt ?? now());
      out.push({
        id: row.fields.id ?? row.id,
        signal: name,
        payload,
        delivery: "once",
        attempts: Number(row.fields.attempts ?? 0),
        failures: parseFailures(row.fields.failures),
        createdAt: at,
        availableAt: at,
        status: "dead",
      });
    }
    return out;
  }

  async function drainOnceStreams(): Promise<void> {
    const consumer = options.consumerId ?? "local";
    for (const [name, decl] of options.signals) {
      if (decl.delivery !== "once") continue;
      const key = streamKey(name);
      await wire.xgroupCreate(key, STREAM_GROUP, "0", { mkstream: true });
      const rows = await wire.xreadgroup(STREAM_GROUP, consumer, key, 32);
      const seen = new Set<string>();
      for (const row of rows) {
        if (seen.has(row.id) || isInflight(redis, key, consumer, row.id)) continue;
        seen.add(row.id);
        const handler = onceHandlers.get(name)?.[0];
        if (!handler) continue;
        let payload: unknown = null;
        try {
          payload = JSON.parse(row.fields.payload ?? "null");
        } catch {
          payload = null;
        }
        markInflight(redis, key, STREAM_GROUP, consumer, row.id);
        const attempt = await wire.hincrby(attemptsKey(name), row.id, 1);
        try {
          await handler(streamMessage(name, row.id, payload, attempt));
          await wire.xack(key, STREAM_GROUP, row.id);
          await wire.hdel(attemptsKey(name), row.id);
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
              await wire.xadd(deadKey(name), "*", {
                id: row.id,
                signal: name,
                payload: JSON.stringify(payload ?? null),
                attempts: String(attempt),
                failures: JSON.stringify([failure]),
                createdAt: String(now()),
              });
            }
            await wire.xack(key, STREAM_GROUP, row.id);
            await wire.hdel(attemptsKey(name), row.id);
          }
        } finally {
          unmarkInflight(redis, key, consumer, row.id);
        }
      }
      await reapIdleConsumers(key, consumer);
    }
  }

  async function relayToRedis(signal: string, payload: unknown): Promise<void> {
    const decl = options.signals.get(signal);
    if (!decl) return;
    if (decl.delivery === "once") {
      const key = streamKey(signal);
      await wire.xgroupCreate(key, STREAM_GROUP, "0", { mkstream: true });
      await wire.xadd(key, "*", { payload: JSON.stringify(payload ?? null), signal });
      return;
    }
    const body = pubBody(crypto.randomUUID(), origin, payload);
    if (decl.delivery === "broadcast") {
      await wire.publish(bcastChannel(signal), body);
    } else {
      await wire.publish(liveChannel(signal), body);
    }
  }

  return {
    driverId: "redis",
    async emit(signal, payload, emitOptions) {
      await outbox.emit(signal, payload, emitOptions);
      await relayToRedis(signal, payload);
    },
    async begin() {
      const staged: Array<{ signal: string; payload: unknown }> = [];
      const tx = await outbox.begin();
      return {
        write: (k, v) => tx.write(k, v),
        async emit(signal, payload, emitOptions) {
          staged.push({ signal, payload });
          await tx.emit(signal, payload, emitOptions);
        },
        async commit() {
          await tx.commit();
          for (const e of staged) await relayToRedis(e.signal, e.payload);
        },
        rollback: () => tx.rollback(),
      };
    },
    async subscribe(signal, subscriberId, handler) {
      if (compete && options.signals.get(signal)?.delivery === "once") {
        const list = onceHandlers.get(signal) ?? [];
        list.push(handler);
        onceHandlers.set(signal, list);
        return () => {
          const next = (onceHandlers.get(signal) ?? []).filter((item) => item !== handler);
          onceHandlers.set(signal, next);
        };
      }
      if (options.signals.get(signal)?.delivery === "broadcast") {
        const list = remoteHandlers.get(signal) ?? [];
        list.push(handler);
        remoteHandlers.set(signal, list);
        const unsub = await outbox.subscribe(signal, subscriberId, handler);
        return () => {
          const next = (remoteHandlers.get(signal) ?? []).filter((item) => item !== handler);
          if (next.length === 0) remoteHandlers.delete(signal);
          else remoteHandlers.set(signal, next);
          return unsub();
        };
      }
      return outbox.subscribe(signal, subscriberId, handler);
    },
    live(signal, opts) {
      return createLiveIterable(async (emit) => {
        if (opts?.afterId !== undefined && opts.afterId.length > 0) {
          await outbox.checkLiveResume(signal, opts.afterId);
        }
        const set = liveSet(signal);
        set.add(emit);
        const iterator = outbox.live(signal, opts)[Symbol.asyncIterator]();
        let stopped = false;
        const pump = async (): Promise<void> => {
          try {
            for (;;) {
              if (stopped) break;
              const next = await iterator.next();
              if (stopped || next.done) break;
              emit(next.value);
            }
          } catch {
            /* Iterator closed. */
          }
        };
        void pump();
        return () => {
          stopped = true;
          set.delete(emit);
          if (set.size === 0) liveEmitters.delete(signal);
          void iterator.return?.();
        };
      });
    },
    checkLiveResume: (signal, afterId) => outbox.checkLiveResume(signal, afterId),
    async drain() {
      if (compete) await drainOnceStreams();
      await outbox.drain();
    },
    async deadLetters(signalName) {
      const rest = await outbox.deadLetters(signalName);
      const fromStream = await readDeadLetters(signalName);
      return [...rest, ...fromStream];
    },
    inspect: (signalName) => outbox.inspect(signalName),
    replay: (opts) => outbox.replay(opts),
    discard: (opts) => outbox.discard(opts),
    getWrite: (k) => outbox.getWrite(k),
    async close() {
      stopHeartbeat();
      for (const unsub of channelUnsubs) await unsub();
      if (ownsClient) await wire.close();
      await outbox.close();
    },
  };
}

/** Protocol-named redis signal driver. */
export const redisSignalDriver: SignalDriver = {
  id: "redis",
  open: openRedisSignal,
};
