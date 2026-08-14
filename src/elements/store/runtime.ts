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
  SqlConnectOptions,
  SqlDriver,
  SqlRole,
  SqlRow,
  TextIndexSearchOptions,
  TextIndexSearchResult,
  VectorIndexDriver,
  VectorIndexStore,
} from "../../drivers/types.ts";
import { indexDriverNeedsSql } from "../../drivers/types.ts";
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
import { createGatedFilesStoreHandle, type GatedFilesFxBridge } from "./files-fx.ts";
import {
  createFilesImagePipeline,
  putImageToBucket,
  type FilesImageOptions,
  type FilesImagePipeline,
  type PutImageOptions,
  type PutImageResult,
} from "./files-image.ts";

export type { GatedFilesFxBridge } from "./files-fx.ts";
export { createGatedFilesStoreHandle } from "./files-fx.ts";

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
    Record<
      string,
      {
        readonly dims?: number;
        readonly url?: string;
        readonly apiKey?: string;
        readonly sql?: SqlConnection;
      }
    >
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
  /**
   * Remaining TTL in milliseconds, or `null` when the key has no expiry.
   *
   * @param key - Entry key
   */
  ttlMs(key: string): Promise<number | null>;
}

/** Files handle on `fx.store`. */
export interface FilesStoreFxHandle {
  readonly ref: `files:${string}`;
  readonly driverId: "memory" | "fs" | "s3";
  put(key: string, data: Uint8Array | string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<boolean>;
  list(prefix?: string): Promise<string[]>;
  /**
   * Chainable Bun.Image pipeline over a stored key or raw bytes.
   *
   * @param source - Object key or image bytes
   * @param options - Decode guards (`maxPixels`, `autoOrient`)
   */
  image(source: string | Uint8Array, options?: FilesImageOptions): FilesImagePipeline;
  /**
   * Put an original image and optional named variants / LQIP.
   *
   * @param key - Object key for the original
   * @param data - Image bytes (or UTF-8 string, same as {@link put})
   * @param opts - Variants / placeholder / decode guards
   */
  putImage(key: string, data: Uint8Array | string, opts?: PutImageOptions): Promise<PutImageResult>;
}

/** Vector index handle on `fx.store`. */
export interface VectorIndexStoreFxHandle {
  readonly ref: `index:${string}`;
  readonly driverId: "memory" | "pgvector";
  upsert(id: string, vector: readonly number[], meta?: Record<string, unknown>): Promise<void>;
  search(
    vector: readonly number[],
    topK?: number,
  ): Promise<ReadonlyArray<{ id: string; score: number; meta?: Record<string, unknown> }>>;
  delete(id: string): Promise<boolean>;
}

/** Full-text index handle on `fx.store`. */
export interface TextIndexStoreFxHandle {
  readonly ref: `index:${string}`;
  readonly driverId: "meilisearch";
  upsert(id: string, document: Record<string, unknown>): Promise<void>;
  search(q: string, opts?: TextIndexSearchOptions): Promise<TextIndexSearchResult>;
  delete(id: string): Promise<boolean>;
}

/** Index handle on `fx.store` — discriminated by `driverId`. */
export type IndexStoreFxHandle = VectorIndexStoreFxHandle | TextIndexStoreFxHandle;

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
  /**
   * Capability-gated files handle for `fx.store` (CRUD + image pipeline).
   *
   * Lives on the runtime so the kernel edge profile does not pull Bun.Image.
   *
   * @param decl - Files store declaration
   * @param ctx - Effects + reveal policy for {@link open}
   * @param bridge - fx gate + dry-run hooks
   */
  openFilesFx(
    decl: FilesStoreDecl,
    ctx: StoreInvokeContext,
    bridge: GatedFilesFxBridge,
  ): FilesStoreFxHandle;
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
  const clientIds = new WeakMap<object, number>();
  let nextClientId = 0;

  /** Injected test clients with the same URL still get distinct cache entries. */
  function clientTag(client: unknown): string {
    if ((typeof client !== "object" && typeof client !== "function") || client === null) return "";
    let id = clientIds.get(client as object);
    if (id === undefined) {
      id = ++nextClientId;
      clientIds.set(client as object, id);
    }
    return `#c${id}`;
  }

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
      // PGlite / postgres-shaped drivers persist under `.oke/`; the in-process
      // `memory` SQL driver ignores `url`. Never use SQLite's `:memory:` here —
      // PGlite treats that string as a filesystem path and creates `./:memory:`.
      primary: { url: ".oke/pgdata" },
    };
    const target = resolveSqlTarget(binding, ctx.effects);
    const driver = options.drivers.sql;
    if (!driver) throw new Error("No sql driver configured");

    const conn = await sharedSqlConn(driver, target.role, target.options);
    return createSqlStoreHandle(`sql:${decl.name}`, {
      connection: conn,
      classifications: classificationsFor(decl),
      revealPii: ctx.revealPii,
      routedRole: target.role,
      domainDdl: options.domainDdl ?? "ensure",
    });
  }

  /**
   * One connection per driver+role+URL (+ injected client) — `store.sql` and a
   * SQL-backed `store.index` share the same already-open connection, never a
   * second one.
   */
  async function sharedSqlConn(
    driver: SqlDriver,
    role: SqlRole,
    connectOptions: SqlConnectOptions,
  ): Promise<SqlConnection> {
    const cacheKey = `${driver.id}:${role}:${connectOptions.url ?? ""}${clientTag(connectOptions.client)}`;
    let conn = sqlConns.get(cacheKey);
    if (!conn) {
      conn = await driver.connect({ ...connectOptions, role });
      sqlConns.set(cacheKey, conn);
    }
    return conn;
  }

  /** SQL-backed index drivers borrow the sql facet's connection. */
  async function sqlConnForIndex(
    driver: VectorIndexDriver & { id: "pgvector" },
    url: string | undefined,
  ): Promise<SqlConnection> {
    const sqlDriver = options.drivers.sql;
    if (!sqlDriver) {
      throw new Error(
        `oke store: index driver "${driver.id}" needs a configured sql driver to share its connection`,
      );
    }
    if (sqlDriver.id !== "postgres" && sqlDriver.id !== "pglite") {
      throw new Error(
        `oke store: index driver "pgvector" cannot share sql driver "${sqlDriver.id}" — ` +
          `pgvector needs store.sql on "postgres" or "pglite"`,
      );
    }
    return sharedSqlConn(sqlDriver, "primary", { url });
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
      ttlMs: (key) => ns!.ttlMs(key),
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
    const access = {
      get: (key: string) => bucket!.get(key),
      put: (key: string, data: Uint8Array | string) => bucket!.put(key, data),
    };
    return {
      ref: `files:${decl.name}`,
      driverId: bucket.driverId,
      put: (key, data) => bucket!.put(key, data),
      get: (key) => bucket!.get(key),
      delete: (key) => bucket!.delete(key),
      list: (prefix) => bucket!.list(prefix),
      image: (source, imageOpts) => createFilesImagePipeline(access, source, imageOpts),
      putImage: (key, data, putOpts) => putImageToBucket(access, key, data, putOpts),
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
        apiKey: binding.apiKey,
        sql: indexDriverNeedsSql(driver)
          ? (binding.sql ?? (await sqlConnForIndex(driver, binding.url)))
          : undefined,
      });
      indexes.set(decl.name, idx);
    }
    if (idx.driverId === "meilisearch") {
      const text = idx;
      return {
        ref: `index:${decl.name}`,
        driverId: text.driverId,
        upsert: (id, document) => text.upsert(id, document),
        search: (q, opts) => text.search(q, opts),
        delete: (id) => text.delete(id),
      };
    }
    const vector = idx as VectorIndexStore;
    return {
      ref: `index:${decl.name}`,
      driverId: vector.driverId,
      upsert: (id, vec, meta) => vector.upsert(id, vec, meta),
      search: (vec, topK) => vector.search(vec, topK),
      delete: (id) => vector.delete(id),
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
      const resources = (effects.reads ?? []).filter((r): r is ResourceRef => r !== "runs");
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
    openFilesFx(decl, ctx, bridge) {
      const cache: { handle?: FilesStoreFxHandle } = {};
      return createGatedFilesStoreHandle(
        decl,
        async () => {
          if (!cache.handle) {
            cache.handle = (await runtime.open(decl, ctx)) as FilesStoreFxHandle;
          }
          return cache.handle;
        },
        bridge,
      );
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
