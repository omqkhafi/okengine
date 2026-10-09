/**
 * Cross-instance cache invalidation.
 *
 * Redis publishes `{ origin, resources }` on `oke:cache:invalidate`.
 * Postgres, when Redis is not configured, inserts into `oke_cache_invalidations`
 * and polls on database time. A process applies remote notices with
 * {@link StoreCache.acceptRemote} and does not publish them again.
 * Memory and single-instance apps do not broadcast. A missed notice is
 * bounded by the cache TTL.
 */

import { execIfNotExists } from "../../drivers/pg-ddl.ts";
import type { ResourceRef } from "../../manifest/types.ts";
import type { StoreCache } from "./cache.ts";

/** Redis pub/sub channel for cache invalidation. */
export const CACHE_INVALIDATE_CHANNEL = "oke:cache:invalidate";

/** Postgres table for cache invalidation when Redis is not configured. */
export const CACHE_INVALIDATIONS_TABLE = "oke_cache_invalidations";

/** Default overlap when polling the Postgres invalidation table. */
const DEFAULT_LAG_MS = 30_000;

/** Drop Postgres rows older than this. */
const RETAIN_MS = 120_000;

/** Redis commands the bus needs. */
export interface CacheBusRedis {
  /**
   * Publish one message.
   *
   * @param channel - Channel name
   * @param message - JSON payload
   */
  publish(channel: string, message: string): Promise<unknown>;
  /**
   * Subscribe. The returned function removes the listener.
   *
   * @param channel - Channel name
   * @param listener - Message callback
   */
  subscribe(channel: string, listener: (message: string) => void): Promise<() => void>;
}

/** SQL surface the Postgres bus uses. Placeholders are `?`. */
export interface CacheBusSql {
  /**
   * Run a query and return rows.
   *
   * @param sql - Statement
   * @param params - Bound parameters
   */
  query(sql: string, params?: readonly unknown[]): Promise<ReadonlyArray<Record<string, unknown>>>;
  /**
   * Run a statement.
   *
   * @param sql - Statement
   * @param params - Bound parameters
   */
  exec(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
}

/** How {@link openCacheInvalidation} reaches other instances. */
export type CacheBusOptions =
  | {
      readonly kind: "redis";
      readonly redis: CacheBusRedis;
      /** Sender id. Remote notices with this origin are ignored. */
      readonly origin?: string;
    }
  | {
      readonly kind: "postgres";
      readonly sql: () => Promise<CacheBusSql | undefined>;
      readonly origin?: string;
      /** Overlap behind the cursor. Default 30_000. */
      readonly lagMs?: number;
      /** Clock for the fleet snapshot. Default `Date.now`. */
      readonly now?: () => number;
    };

/** Handle returned by {@link openCacheInvalidation}. */
export interface CacheInvalidationBus {
  /** Tell other instances these resources changed. */
  publish(resources: readonly ResourceRef[]): void;
  /** Pull Postgres notices. No-op for Redis. */
  poll(): Promise<void>;
  /** Stop the subscription or poll. */
  stop(): Promise<void>;
}

/**
 * Bind `cache` to Redis or Postgres invalidation.
 *
 * @param cache - Local cache
 * @param options - Transport
 */
export function openCacheInvalidation(
  cache: StoreCache,
  options: CacheBusOptions,
): CacheInvalidationBus {
  const origin = options.origin ?? crypto.randomUUID();
  if (options.kind === "redis") return openRedis(cache, options.redis, origin);
  return openPostgres(
    cache,
    options.sql,
    origin,
    options.lagMs ?? DEFAULT_LAG_MS,
    options.now ?? Date.now,
  );
}

/**
 * Bun Redis client for the invalidation channel.
 * Subscribe uses its own connection.
 *
 * @param url - Redis URL
 */
export function bunRedisCacheClient(url: string): CacheBusRedis {
  const pub = new Bun.RedisClient(url);
  const sub = new Bun.RedisClient(url);
  return {
    publish: (channel, message) => pub.publish(channel, message),
    async subscribe(channel, listener) {
      await sub.subscribe(channel, (message) => {
        listener(message);
      });
      return () => {
        void sub.unsubscribe(channel);
      };
    },
  };
}

function openRedis(cache: StoreCache, redis: CacheBusRedis, origin: string): CacheInvalidationBus {
  let unsub: (() => void) | undefined;
  let stopped = false;
  const ready = redis
    .subscribe(CACHE_INVALIDATE_CHANNEL, (message) => {
      if (stopped) return;
      const resources = resourcesFromMessage(message, origin);
      if (resources.length > 0) cache.acceptRemote(resources);
    })
    .then((stop) => {
      unsub = stop;
    })
    .catch((err: unknown) => {
      console.error(err);
    });
  return {
    publish(resources) {
      if (stopped || resources.length === 0) return;
      const body = JSON.stringify({ origin, resources });
      void redis.publish(CACHE_INVALIDATE_CHANNEL, body).catch((err: unknown) => {
        console.error(err);
      });
    },
    poll: async () => {},
    async stop() {
      stopped = true;
      await ready;
      unsub?.();
      unsub = undefined;
    },
  };
}

function openPostgres(
  cache: StoreCache,
  connect: () => Promise<CacheBusSql | undefined>,
  origin: string,
  lagMs: number,
  now: () => number,
): CacheInvalidationBus {
  let stopped = false;
  let opening: Promise<void> | undefined;
  let cursor = 0;
  let othersAlive = false;
  let registryKnown = false;
  let fleetCheckedAt = 0;
  const seen = new Set<string>();

  function shouldNotify(): boolean {
    if (!registryKnown) return true;
    if (now() - fleetCheckedAt > POLL_INTERVAL_MS) return true;
    return othersAlive;
  }

  async function anchor(conn: CacheBusSql): Promise<void> {
    const rows = await conn.query(ANCHOR_SQL);
    let dbNow = 0;
    for (const row of rows) {
      const clock = asNumber(row.db_now);
      if (clock > dbNow) dbNow = clock;
      const id = asString(row.id);
      if (id) seen.add(id);
    }
    cursor = dbNow;
  }

  function startOpening(): Promise<void> {
    if (!opening) {
      opening = (async () => {
        const conn = await connect();
        if (!conn || stopped) return;
        await ensure(conn);
        await anchor(conn);
        await refreshFleet(conn);
      })();
    }
    return opening;
  }

  async function sql(): Promise<CacheBusSql | undefined> {
    if (stopped) return undefined;
    await startOpening();
    if (stopped) return undefined;
    const conn = await connect();
    if (!conn || stopped) return undefined;
    return conn;
  }

  async function poll(): Promise<void> {
    const conn = await sql();
    if (!conn || stopped) return;
    const clock = await conn.query(DB_NOW_SQL);
    const dbNow = asNumber(clock[0]?.db_now);
    const since = cursor - lagMs;
    const rows = await conn.query(POLL_SQL, [since]);
    const fresh: ResourceRef[] = [];
    for (const row of rows) {
      const id = asString(row.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (asString(row.origin) === origin) continue;
      const resource = asString(row.resource);
      if (resource) fresh.push(resource as ResourceRef);
    }
    if (fresh.length > 0) cache.acceptRemote(fresh);
    cursor = dbNow;
    await conn.exec(DELETE_SQL, [dbNow - RETAIN_MS]);
    await refreshFleet(conn);
    if (seen.size > 10_000) seen.clear();
  }

  async function refreshFleet(conn: CacheBusSql): Promise<void> {
    try {
      const rows = await conn.query(FLEET_SQL, [origin]);
      othersAlive = asNumber(rows[0]?.n) > 0;
      registryKnown = true;
      fleetCheckedAt = now();
    } catch (err) {
      if (isUndefinedTable(err)) {
        registryKnown = false;
        fleetCheckedAt = 0;
      }
    }
  }

  const timer = setInterval(() => {
    void poll().catch((err: unknown) => {
      console.error(err);
    });
  }, POLL_INTERVAL_MS);
  timer.unref?.();
  // After the caller finishes `let store = createStoreRuntime(...)`, so `sql()`
  // can close over that binding.
  queueMicrotask(() => {
    if (!stopped) void startOpening();
  });

  return {
    publish(resources) {
      if (stopped || resources.length === 0) return;
      void insert(sql, origin, resources, shouldNotify);
    },
    poll,
    async stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function ensure(conn: CacheBusSql): Promise<void> {
  await execIfNotExists(conn, CREATE_SQL);
  await execIfNotExists(conn, INDEX_SQL);
}

async function insert(
  connect: () => Promise<CacheBusSql | undefined>,
  origin: string,
  resources: readonly ResourceRef[],
  shouldNotify: () => boolean,
): Promise<void> {
  const conn = await connect();
  if (!conn || !shouldNotify() || resources.length === 0) return;
  const params: unknown[] = [];
  const tuples = resources.map((resource) => {
    params.push(crypto.randomUUID(), resource, origin);
    return "(?, ?, ?)";
  });
  await conn.exec(
    `INSERT INTO ${CACHE_INVALIDATIONS_TABLE} (id, resource, origin) VALUES ${tuples.join(", ")}`,
    params,
  );
}

function resourcesFromMessage(message: string, origin: string): ResourceRef[] {
  try {
    const parsed: unknown = JSON.parse(message);
    if (parsed === null || typeof parsed !== "object") return [];
    const rec = parsed as Record<string, unknown>;
    if (rec.origin === origin) return [];
    if (!Array.isArray(rec.resources)) return [];
    const out: ResourceRef[] = [];
    for (const item of rec.resources) {
      if (typeof item === "string" && item.length > 0) out.push(item as ResourceRef);
    }
    return out;
  } catch {
    return [];
  }
}

function isUndefinedTable(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current != null && typeof current === "object"; depth++) {
    const rec = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (rec.code === "42P01") return true;
    if (typeof rec.message === "string" && rec.message.includes("42P01")) return true;
    current = rec.cause;
  }
  return false;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS ${CACHE_INVALIDATIONS_TABLE} (
  id TEXT PRIMARY KEY,
  resource TEXT NOT NULL,
  origin TEXT NOT NULL,
  created_at BIGINT NOT NULL DEFAULT ((extract(epoch from clock_timestamp()) * 1000)::bigint)
)`;

const INDEX_SQL = `CREATE INDEX IF NOT EXISTS ${CACHE_INVALIDATIONS_TABLE}_created_at ON ${CACHE_INVALIDATIONS_TABLE} (created_at)`;

const DB_NOW_EXPR = "(extract(epoch from clock_timestamp()) * 1000)::bigint";

const FLEET_SQL = `SELECT count(*)::int AS n FROM oke_instances WHERE lease_expires_at > ${DB_NOW_EXPR} AND id <> ?`;

const DB_NOW_SQL = `SELECT ${DB_NOW_EXPR} AS db_now`;

/** Existing rows plus the database clock, one statement. */
const ANCHOR_SQL = `SELECT i.id, i.resource, i.origin, i.created_at, cache_clock.db_now FROM (SELECT ${DB_NOW_EXPR} AS db_now) AS cache_clock LEFT JOIN ${CACHE_INVALIDATIONS_TABLE} i ON TRUE`;

const POLL_SQL = `SELECT id, resource, origin, created_at FROM ${CACHE_INVALIDATIONS_TABLE} WHERE created_at >= ?`;

/** Own poll, independent of the boot scheduler. Under the 2s convergence window. */
const POLL_INTERVAL_MS = 1_000;

const DELETE_SQL = `DELETE FROM ${CACHE_INVALIDATIONS_TABLE} WHERE created_at < ?`;
