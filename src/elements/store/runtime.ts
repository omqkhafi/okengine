/**
 * Store runtime — binds facet declarations to protocol drivers and produces
 * the handles `fx.store(...)` returns.
 */

import type { DomainDdlMode } from "../../config/index.ts";
import type { Effects, ResourceRef } from "../../manifest/types.ts";
import type {
  ClassificationMap,
  FilesBucket,
  FilesDriver,
  IndexDriver,
  IndexStore,
  KvDriver,
  KvNamespace,
  SqlConnection,
  SqlDriver,
  SqlRow,
} from "../../drivers/types.ts";
import { buildClassificationMap, type MaskRowsOptions } from "./classify.ts";
import {
  createStoreCache,
  computedCacheKey,
  parseTtlMs,
  tier1KeysForReads,
  type StoreCache,
} from "./cache.ts";
import { resolveSqlTarget, type SqlBindingConfig } from "./replica.ts";
import { createSqlStoreHandle, type SqlStoreHandle } from "./sql-session.ts";
import { classificationsFromTable, type TableHandle } from "./table.ts";
import type {
  FilesStoreDecl,
  IndexStoreDecl,
  KvStoreDecl,
  SqlStoreDecl,
  StoreDecl,
} from "./declare.ts";

/** Driver bundle wired into a runtime. */
export interface StoreDriverBundle {
  readonly sql?: SqlDriver;
  readonly kv?: KvDriver;
  readonly files?: FilesDriver;
  readonly index?: IndexDriver;
}

/** SQL binding for one named store. */
export interface SqlRuntimeBinding extends SqlBindingConfig {
  /** Store declaration name. */
  readonly name: string;
}

/** Options for {@link createStoreRuntime}. */
export interface CreateStoreRuntimeOptions {
  /** Protocol drivers. */
  readonly drivers: StoreDriverBundle;
  /** SQL bindings keyed by store name. */
  readonly sql?: Readonly<Record<string, SqlRuntimeBinding>>;
  /** KV open options keyed by store name. */
  readonly kv?: Readonly<Record<string, { readonly url?: string; readonly client?: unknown }>>;
  /** Files open options keyed by store name. */
  readonly files?: Readonly<Record<string, { readonly root?: string; readonly client?: unknown }>>;
  /** Index open options keyed by store name. */
  readonly index?: Readonly<
    Record<string, { readonly dims?: number; readonly url?: string; readonly sql?: SqlConnection }>
  >;
  /** Clock for cache TTLs. */
  readonly now?: () => number;
  /**
   * Domain DDL policy for SQL handles. Default `ensure` (test-friendly).
   * Boot sets `off` for docker/prod and local+autoPush.
   */
  readonly domainDdl?: DomainDdlMode;
}

/** Per-invocation context when opening a handle through the runtime. */
export interface StoreInvokeContext {
  /** Flow effects — drive replica routing and cache keys. */
  readonly effects: Effects;
  /** Reveal PII (gated elsewhere). */
  readonly revealPii?: boolean;
}

/** Unified handle returned for any facet. */
export type StoreHandle =
  | SqlStoreHandle
  | KvStoreFxHandle
  | FilesStoreFxHandle
  | IndexStoreFxHandle;

/** KV handle on `fx.store`. */
export interface KvStoreFxHandle {
  readonly ref: `kv:${string}`;
  readonly driverId: "memory" | "redis";
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttl?: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  /**
   * List keys (Console Store browser).
   *
   * @param prefix - Optional prefix filter
   */
  list(prefix?: string): Promise<string[]>;
}

/** Files handle on `fx.store`. */
export interface FilesStoreFxHandle {
  readonly ref: `files:${string}`;
  readonly driverId: "memory" | "fs" | "s3";
  put(key: string, data: Uint8Array | string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<boolean>;
  list(prefix?: string): Promise<string[]>;
}

/** Index handle on `fx.store`. */
export interface IndexStoreFxHandle {
  readonly ref: `index:${string}`;
  readonly driverId: "memory" | "pgvector";
  upsert(id: string, vector: readonly number[], meta?: Record<string, unknown>): Promise<void>;
  search(
    vector: readonly number[],
    topK?: number,
  ): Promise<Array<{ id: string; score: number; meta?: Record<string, unknown> }>>;
  delete(id: string): Promise<boolean>;
}

/** Store runtime. */
export interface StoreRuntime {
  /** Shared multi-tier cache. */
  readonly cache: StoreCache;
  /**
   * Open a handle for a store declaration under the given invoke context.
   *
   * @param decl - Store declaration from `store.sql` / `kv` / …
   * @param ctx - Effects + reveal policy
   */
  open(decl: StoreDecl, ctx: StoreInvokeContext): Promise<StoreHandle>;
  /**
   * Open by resource ref string.
   *
   * @param ref - `facet:name`
   * @param ctx - Invoke context
   */
  openRef(ref: ResourceRef, ctx: StoreInvokeContext): Promise<StoreHandle>;
  /**
   * Register a declaration (usually done at module load).
   *
   * @param decl - Declaration to register
   */
  register(decl: StoreDecl): void;
  /** Registered declarations. */
  readonly declarations: ReadonlyMap<string, StoreDecl>;
  /**
   * After a write flow: invalidate tier-1 keys for written resources.
   *
   * @param effects - Write flow effects
   */
  onWriteEffects(effects: Effects): ReturnType<StoreCache["invalidateFromEffects"]>;
  /**
   * Seed / remember tier-1 entries for a read flow.
   *
   * @param effects - Read effects
   * @param value - Cached payload
   * @param dimsByResource - Optional key dimensions
   */
  putTier1(
    effects: Effects,
    value: unknown,
    dimsByResource?: Readonly<Record<string, readonly string[]>>,
  ): string[];
  /** Close all open connections. */
  close(): Promise<void>;
}

/**
 * Create a store runtime bound to protocol drivers.
 *
 * @param options - Drivers and per-store bindings
 */
export function createStoreRuntime(options: CreateStoreRuntimeOptions): StoreRuntime {
  const now = options.now ?? (() => Date.now());
  const cache = createStoreCache(now);
  const declarations = new Map<string, StoreDecl>();
  const sqlConns = new Map<string, SqlConnection>();
  const kvNs = new Map<string, KvNamespace>();
  const fileBuckets = new Map<string, FilesBucket>();
  const indexes = new Map<string, IndexStore>();

  function classificationsFor(decl: SqlStoreDecl): ClassificationMap {
    const nested: Record<
      string,
      Record<string, import("../../manifest/types.ts").ColumnClassification>
    > = { ...(decl.classify ?? {}) };
    if (decl.schema) {
      for (const value of Object.values(decl.schema)) {
        if (value && typeof value === "object" && "columns" in value) {
          const table = value as TableHandle;
          nested[table.name] = {
            ...(nested[table.name] ?? {}),
            ...classificationsFromTable(table),
          };
        }
      }
    }
    return buildClassificationMap(nested);
  }

  async function openSql(decl: SqlStoreDecl, ctx: StoreInvokeContext): Promise<SqlStoreHandle> {
    const binding = options.sql?.[decl.name] ?? {
      name: decl.name,
      primary: { url: ":memory:" },
    };
    const target = resolveSqlTarget(binding, ctx.effects);
    const driver = options.drivers.sql;
    if (!driver) throw new Error("No sql driver configured");

    const cacheKey = `${decl.name}:${target.role}:${JSON.stringify(target.options.url ?? "")}`;
    let conn = sqlConns.get(cacheKey);
    if (!conn) {
      conn = await driver.connect(target.options);
      sqlConns.set(cacheKey, conn);
    }

    return createSqlStoreHandle(`sql:${decl.name}`, {
      connection: conn,
      classifications: classificationsFor(decl),
      revealPii: ctx.revealPii,
      routedRole: target.role,
      domainDdl: options.domainDdl ?? "ensure",
    });
  }

  async function openKv(decl: KvStoreDecl): Promise<KvStoreFxHandle> {
    const driver = options.drivers.kv;
    if (!driver) throw new Error("No kv driver configured");
    let ns = kvNs.get(decl.name);
    if (!ns) {
      const binding = options.kv?.[decl.name] ?? {};
      ns = await driver.open({
        name: decl.name,
        url: binding.url,
        client: binding.client as never,
      });
      kvNs.set(decl.name, ns);
    }
    const driverId = ns.driverId;
    return {
      ref: `kv:${decl.name}`,
      driverId,
      get: (key) => ns!.get(key),
      set: (key, value, ttl) => ns!.set(key, value, ttl),
      delete: (key) => ns!.delete(key),
      list: (prefix) => ns!.list(prefix),
    };
  }

  async function openFiles(decl: FilesStoreDecl): Promise<FilesStoreFxHandle> {
    const driver = options.drivers.files;
    if (!driver) throw new Error("No files driver configured");
    let bucket = fileBuckets.get(decl.name);
    if (!bucket) {
      const binding = options.files?.[decl.name] ?? {};
      bucket = await driver.open({
        name: decl.name,
        root: binding.root,
        client: binding.client as never,
      });
      fileBuckets.set(decl.name, bucket);
    }
    return {
      ref: `files:${decl.name}`,
      driverId: bucket.driverId,
      put: (key, data) => bucket!.put(key, data),
      get: (key) => bucket!.get(key),
      delete: (key) => bucket!.delete(key),
      list: (prefix) => bucket!.list(prefix),
    };
  }

  async function openIndex(decl: IndexStoreDecl): Promise<IndexStoreFxHandle> {
    const driver = options.drivers.index;
    if (!driver) throw new Error("No index driver configured");
    let idx = indexes.get(decl.name);
    if (!idx) {
      const binding = options.index?.[decl.name] ?? {};
      idx = await driver.open({
        name: decl.name,
        dims: binding.dims ?? decl.dims ?? 3,
        url: binding.url,
        sql: binding.sql,
      });
      indexes.set(decl.name, idx);
    }
    return {
      ref: `index:${decl.name}`,
      driverId: idx.driverId,
      upsert: (id, vector, meta) => idx!.upsert(id, vector, meta),
      search: (vector, topK) => idx!.search(vector, topK),
      delete: (id) => idx!.delete(id),
    };
  }

  const runtime: StoreRuntime = {
    cache,
    declarations,
    register(decl) {
      declarations.set(`${decl.facet}:${decl.name}`, decl);
    },
    async open(decl, ctx) {
      switch (decl.facet) {
        case "sql":
          return openSql(decl, ctx);
        case "kv":
          return openKv(decl);
        case "files":
          return openFiles(decl);
        case "index":
          return openIndex(decl);
        default: {
          const _exhaustive: never = decl;
          return _exhaustive;
        }
      }
    },
    async openRef(ref, ctx) {
      const decl = declarations.get(ref);
      if (!decl) throw new Error(`Unknown store ref: ${ref}`);
      return this.open(decl, ctx);
    },
    onWriteEffects(effects) {
      return cache.invalidateFromEffects(effects);
    },
    putTier1(effects, value, dimsByResource) {
      const keys = tier1KeysForReads(effects, dimsByResource);
      const resources = effects.reads ?? [];
      for (const key of keys) {
        cache.set({
          tier: 1,
          key,
          value,
          resources,
          expiresAt: null,
        });
      }
      return keys;
    },
    async close() {
      for (const c of sqlConns.values()) await c.close();
      for (const n of kvNs.values()) await n.close();
      for (const b of fileBuckets.values()) await b.close();
      for (const i of indexes.values()) await i.close();
      sqlConns.clear();
      kvNs.clear();
      fileBuckets.clear();
      indexes.clear();
    },
  };

  return runtime;
}

/**
 * Helper: cache a tier-2 flow result.
 *
 * @param cache - Store cache
 * @param key - Explicit key
 * @param ttl - TTL string
 * @param value - Value
 * @param now - Clock
 */
export function putTier2(
  cache: StoreCache,
  key: string,
  ttl: string,
  value: unknown,
  now: () => number = () => Date.now(),
): void {
  const ms = parseTtlMs(ttl);
  cache.set({
    tier: 2,
    key,
    value,
    resources: [],
    expiresAt: ms > 0 ? now() + ms : null,
  });
}

export { computedCacheKey };
export type { SqlRow, MaskRowsOptions };
