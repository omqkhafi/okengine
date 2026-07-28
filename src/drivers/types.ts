/**
 * Protocol-named store driver contracts.
 *
 * Driver ids are protocols/standards (`postgres`, `redis`, `s3`) — never vendors.
 * Vendor choice lives in `images`, keyed by role.
 */

import type { ColumnClassification, StoreFacet } from "../manifest/types.ts";

/** Protocol ids for store drivers in scope. */
export type StoreDriverId = "sqlite" | "postgres" | "memory" | "redis" | "fs" | "s3" | "pgvector";

/** Facets a driver may serve. */
export type DriverFacet = StoreFacet;

/** Connection role for SQL routing. */
export type SqlRole = "primary" | "replica";

/** A SQL row as a plain object. */
export type SqlRow = Record<string, unknown>;

/** Options when opening a SQL connection. */
export interface SqlConnectOptions {
  /** Connection URL or path (`:memory:`, `file:…`, `postgres://…`). */
  readonly url?: string;
  /** Explicit role (defaults to primary). */
  readonly role?: SqlRole;
  /** Pool / open hint — ignored by memory/sqlite. */
  readonly pool?: { readonly max?: number };
  /**
   * Injected client for tests (Bun.SQL-compatible query fn, or bun:sqlite Database).
   * Production code omits this and binds the native client.
   */
  readonly client?: unknown;
}

/** Low-level SQL connection used by every sql driver. */
export interface SqlConnection {
  /** Protocol driver id. */
  readonly driverId: "sqlite" | "postgres" | "memory";
  /** Primary vs replica. */
  readonly role: SqlRole;
  /**
   * Run a parameterised query and return rows.
   *
   * @param sql - SQL text with `?` placeholders
   * @param params - Bound parameters
   */
  query(sql: string, params?: readonly unknown[]): Promise<SqlRow[]>;
  /**
   * Execute a statement (DDL / DML) and return change count when known.
   *
   * @param sql - SQL text with `?` placeholders
   * @param params - Bound parameters
   */
  exec(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
  /** Close the connection. */
  close(): Promise<void>;
}

/** SQL driver factory. */
export interface SqlDriver {
  /** Protocol id. */
  readonly id: "sqlite" | "postgres" | "memory";
  /** Facet this driver serves. */
  readonly facet: "sql";
  /**
   * Open a connection.
   *
   * @param options - URL / role / injected client
   */
  connect(options?: SqlConnectOptions): Promise<SqlConnection>;
}

/** Key-value namespace handle. */
export interface KvNamespace {
  /** Protocol driver id. */
  readonly driverId: "memory" | "redis";
  /**
   * Read a key.
   *
   * @param key - Entry key
   */
  get(key: string): Promise<unknown>;
  /**
   * Write a key.
   *
   * @param key - Entry key
   * @param value - JSON-serialisable value
   * @param ttl - Optional TTL string (e.g. `"5m"`) — best-effort
   */
  set(key: string, value: unknown, ttl?: string): Promise<void>;
  /**
   * Delete a key.
   *
   * @param key - Entry key
   */
  delete(key: string): Promise<boolean>;
  /**
   * Atomically evaluate a Lua script (redis `EVAL` semantics).
   *
   * Keys are namespaced by the driver. Used by Gate rate strategies.
   *
   * @param script - Lua source
   * @param keys - KEYS table entries (unprefixed)
   * @param args - ARGV table entries
   */
  eval<T = unknown>(script: string, keys: readonly string[], args?: readonly string[]): Promise<T>;
  /**
   * List keys in this namespace, optionally by prefix (Console Store browser).
   *
   * @param prefix - Key prefix filter
   */
  list(prefix?: string): Promise<string[]>;
  /** Close / release. */
  close(): Promise<void>;
}

/** Options when opening a KV namespace. */
export interface KvOpenOptions {
  /** Namespace name. */
  readonly name: string;
  /** Redis URL when using the redis driver. */
  readonly url?: string;
  /** Injected client for tests. */
  readonly client?: KvClientLike;
  /** Injectable clock for Lua EVAL TTLs (memory / fakes). */
  readonly nowMs?: () => number;
}

/** Minimal Redis-like client used by the redis driver (and test fakes). */
export interface KvClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  /**
   * Redis `EVAL` — required for atomic Gate rate strategies.
   *
   * @param script - Lua source
   * @param numkeys - KEYS count
   * @param keysAndArgs - KEYS then ARGV
   */
  eval?(script: string, numkeys: number, ...keysAndArgs: string[]): Promise<unknown>;
  /**
   * Raw command send (Bun.RedisClient). Used when `eval` is absent.
   *
   * @param command - Redis command name
   * @param args - Command arguments
   */
  send?(command: string, args: string[]): Promise<unknown>;
  /**
   * Redis `SCAN` cursor iteration — optional; used for Console key browse.
   *
   * @param cursor - Cursor string
   * @param opts - MATCH / COUNT
   */
  scan?(
    cursor: string,
    opts?: { readonly match?: string; readonly count?: number },
  ): Promise<[string, string[]]>;
}

/** KV driver factory. */
export interface KvDriver {
  readonly id: "memory" | "redis";
  readonly facet: "kv";
  /**
   * Open a namespace.
   *
   * @param options - Name / URL / client
   */
  open(options: KvOpenOptions): Promise<KvNamespace>;
}

/** Object / file store handle. */
export interface FilesBucket {
  readonly driverId: "memory" | "fs" | "s3";
  /**
   * Write an object.
   *
   * @param key - Object key
   * @param data - Bytes or UTF-8 string
   */
  put(key: string, data: Uint8Array | string): Promise<void>;
  /**
   * Read an object.
   *
   * @param key - Object key
   */
  get(key: string): Promise<Uint8Array | null>;
  /**
   * Delete an object.
   *
   * @param key - Object key
   */
  delete(key: string): Promise<boolean>;
  /**
   * List object keys, optionally by prefix.
   *
   * @param prefix - Key prefix filter
   */
  list(prefix?: string): Promise<string[]>;
  /** Close / release. */
  close(): Promise<void>;
}

/** Options when opening a files bucket. */
export interface FilesOpenOptions {
  /** Bucket / root name. */
  readonly name: string;
  /** Local root path (`fs`) or S3 bucket name. */
  readonly root?: string;
  /** Injected S3-like client for tests. */
  readonly client?: S3ClientLike;
}

/** Minimal S3-like surface used by the s3 driver (and test fakes). */
export interface S3ClientLike {
  file(key: string): {
    write(data: Uint8Array | string): Promise<number>;
    arrayBuffer(): Promise<ArrayBuffer>;
    exists(): Promise<boolean>;
    delete(): Promise<void>;
  };
  list(options?: { prefix?: string }): Promise<{
    contents?: Array<{ key?: string }>;
  }>;
}

/** Files driver factory. */
export interface FilesDriver {
  readonly id: "memory" | "fs" | "s3";
  readonly facet: "files";
  /**
   * Open a bucket.
   *
   * @param options - Name / root / client
   */
  open(options: FilesOpenOptions): Promise<FilesBucket>;
}

/** Vector index hit. */
export interface IndexHit {
  readonly id: string;
  readonly score: number;
  readonly meta?: Record<string, unknown>;
}

/** Vector index handle. */
export interface IndexStore {
  readonly driverId: "memory" | "pgvector";
  /**
   * Upsert a vector.
   *
   * @param id - Document id
   * @param vector - Embedding
   * @param meta - Optional metadata
   */
  upsert(id: string, vector: readonly number[], meta?: Record<string, unknown>): Promise<void>;
  /**
   * Similarity search (cosine).
   *
   * @param vector - Query embedding
   * @param topK - Max hits
   */
  search(vector: readonly number[], topK?: number): Promise<IndexHit[]>;
  /**
   * Delete a vector.
   *
   * @param id - Document id
   */
  delete(id: string): Promise<boolean>;
  /** Close / release. */
  close(): Promise<void>;
}

/** Options when opening an index. */
export interface IndexOpenOptions {
  /** Index name. */
  readonly name: string;
  /** Vector dimensions. */
  readonly dims: number;
  /** Postgres URL when using pgvector. */
  readonly url?: string;
  /** Injected SQL connection for pgvector tests. */
  readonly sql?: SqlConnection;
}

/** Index driver factory. */
export interface IndexDriver {
  readonly id: "memory" | "pgvector";
  readonly facet: "index";
  /**
   * Open an index.
   *
   * @param options - Name / dims / SQL
   */
  open(options: IndexOpenOptions): Promise<IndexStore>;
}

/** Union of all store drivers. */
export type StoreDriver = SqlDriver | KvDriver | FilesDriver | IndexDriver;

/** Table column classification map: `table.column` → classification. */
export type ClassificationMap = ReadonlyMap<string, ColumnClassification>;

/**
 * Build a `table.column` key for classification lookup.
 *
 * @param table - Table name
 * @param column - Column name
 */
export function classificationKey(table: string, column: string): string {
  return `${table}.${column}`;
}
