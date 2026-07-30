/**
 * Store facet declarations — `store.sql` · `store.kv` · `store.files` · `store.index`.
 *
 * Declarations are data; I/O happens only through drivers via the runtime / `fx`.
 */

import type { ColumnClassification, ResourceRef, StoreFacet } from "../../manifest/types.ts";
import { resource } from "./resource.ts";
import { schema } from "./schema-decl.ts";
import { resolveTableName, type TableHandle } from "./table.ts";

/** CDC trigger shape (mirrors kernel `CdcTrigger` without importing it). */
export interface StoreCdcTrigger {
  readonly kind: "cdc";
  readonly table: string;
  readonly column?: string;
  readonly store?: string;
}

/** Handle from {@link SqlStoreDecl.table}. */
export interface StoreTableCdc {
  readonly name: string;
  /**
   * CDC trigger when `column` (or any column) changes.
   *
   * @param column - Optional column name
   */
  changed(column?: string): StoreCdcTrigger;
}

/** Base fields shared by every facet declaration. */
export interface StoreDeclBase {
  /** Facet kind. */
  readonly facet: StoreFacet;
  /** Logical name (becomes the resource suffix). */
  readonly name: string;
  /** Resource ref `facet:name`. */
  readonly ref: ResourceRef;
}

/** Options for {@link store.sql}. */
export interface SqlStoreOptions {
  /** Optional human description for Console / docs (falls back to the store name). */
  readonly description?: string;
  /**
   * Schema tables — okengine {@link TableHandle}s and/or Drizzle tables.
   * Classification is read from TableHandle columns when present.
   */
  readonly schema?: Readonly<Record<string, TableHandle | unknown>>;
  /**
   * Explicit classifications: `table → column → tags`.
   * Merged with schema-derived tags; wins on conflict for the same column.
   */
  readonly classify?: Readonly<Record<string, Readonly<Record<string, ColumnClassification>>>>;
}

/** SQL store declaration. */
export interface SqlStoreDecl extends StoreDeclBase {
  readonly facet: "sql";
  readonly ref: `sql:${string}`;
  readonly description?: string;
  readonly schema?: SqlStoreOptions["schema"];
  readonly classify?: SqlStoreOptions["classify"];
  /**
   * CDC handle — `db.table(orders).changed("status")`.
   *
   * @param table - Table handle or Drizzle table
   */
  table(table: TableHandle | unknown): StoreTableCdc;
}

/** Options for {@link store.kv}. */
export interface KvStoreOptions {
  /** Optional description. */
  readonly description?: string;
}

/** KV store declaration. */
export interface KvStoreDecl extends StoreDeclBase {
  readonly facet: "kv";
  readonly ref: `kv:${string}`;
  readonly description?: string;
}

/** Options for {@link store.files}. */
export interface FilesStoreOptions {
  /** Optional description. */
  readonly description?: string;
}

/** Files store declaration. */
export interface FilesStoreDecl extends StoreDeclBase {
  readonly facet: "files";
  readonly ref: `files:${string}`;
  readonly description?: string;
}

/** Options for {@link store.index}. */
export interface IndexStoreOptions {
  /** Optional human description for Console / docs (falls back to the index name). */
  readonly description?: string;
  /** Vector dimensions (default 3 for tests; set explicitly in apps). */
  readonly dims?: number;
}

/** Index store declaration. */
export interface IndexStoreDecl extends StoreDeclBase {
  readonly facet: "index";
  readonly ref: `index:${string}`;
  readonly description?: string;
  readonly dims?: number;
}

/** Any store declaration. */
export type StoreDecl = SqlStoreDecl | KvStoreDecl | FilesStoreDecl | IndexStoreDecl;

/**
 * Declare a SQL store.
 *
 * @param name - Store name
 * @param options - Schema / classification
 */
export function sql(name: string, options: SqlStoreOptions = {}): SqlStoreDecl {
  const decl: SqlStoreDecl = {
    facet: "sql",
    name,
    ref: `sql:${name}`,
    ...(options.description !== undefined ? { description: options.description } : {}),
    schema: options.schema,
    classify: options.classify,
    table(table) {
      const tableName = resolveTableName(table);
      return {
        name: tableName,
        changed(column?: string): StoreCdcTrigger {
          return column === undefined
            ? { kind: "cdc", table: tableName, store: name }
            : { kind: "cdc", table: tableName, column, store: name };
        },
      };
    },
  };
  return decl;
}

/**
 * Declare a KV store.
 *
 * @param name - Namespace name
 * @param options - Options
 */
export function kv(name: string, options: KvStoreOptions = {}): KvStoreDecl {
  return {
    facet: "kv",
    name,
    ref: `kv:${name}`,
    ...(options.description !== undefined ? { description: options.description } : {}),
  };
}

/**
 * Declare a files store.
 *
 * @param name - Bucket name
 * @param options - Options
 */
export function files(name: string, options: FilesStoreOptions = {}): FilesStoreDecl {
  return {
    facet: "files",
    name,
    ref: `files:${name}`,
    ...(options.description !== undefined ? { description: options.description } : {}),
  };
}

/**
 * Declare a vector index store.
 *
 * @param name - Index name
 * @param options - Dimensions
 */
export function index(name: string, options: IndexStoreOptions = {}): IndexStoreDecl {
  return {
    facet: "index",
    name,
    ref: `index:${name}`,
    ...(options.description !== undefined ? { description: options.description } : {}),
    dims: options.dims,
  };
}

/** Public `store` element — four facets + abstract schema declare + resource. */
export const store = {
  sql,
  kv,
  files,
  index,
  /** ORM-agnostic table declarations (`store.schema.table`). */
  schema,
  /** CRUD + list factory (`store.resource(db, table, opts)`). */
  resource,
} as const;
