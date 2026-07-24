/**
 * Store facet declarations — `store.sql` · `store.kv` · `store.files` · `store.index`.
 *
 * Declarations are data; I/O happens only through drivers via the runtime / `fx`.
 */

import type { ColumnClassification, ResourceRef, StoreFacet } from "../../manifest/types.ts";
import type { TableHandle } from "./table.ts";

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
  /**
   * Schema tables — okengine {@link TableHandle}s and/or Drizzle tables.
   * Classification is read from TableHandle columns when present.
   */
  readonly schema?: Readonly<Record<string, TableHandle | unknown>>;
  /**
   * Explicit classifications: `table → column → tags`.
   * Merged with schema-derived tags; wins on conflict for the same column.
   */
  readonly classify?: Readonly<
    Record<string, Readonly<Record<string, ColumnClassification>>>
  >;
}

/** SQL store declaration. */
export interface SqlStoreDecl extends StoreDeclBase {
  readonly facet: "sql";
  readonly ref: `sql:${string}`;
  readonly schema?: SqlStoreOptions["schema"];
  readonly classify?: SqlStoreOptions["classify"];
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
  /** Vector dimensions (default 3 for tests; set explicitly in apps). */
  readonly dims?: number;
}

/** Index store declaration. */
export interface IndexStoreDecl extends StoreDeclBase {
  readonly facet: "index";
  readonly ref: `index:${string}`;
  readonly dims?: number;
}

/** Any store declaration. */
export type StoreDecl =
  | SqlStoreDecl
  | KvStoreDecl
  | FilesStoreDecl
  | IndexStoreDecl;

/**
 * Declare a SQL store.
 *
 * @param name - Store name
 * @param options - Schema / classification
 */
export function sql(name: string, options: SqlStoreOptions = {}): SqlStoreDecl {
  return {
    facet: "sql",
    name,
    ref: `sql:${name}`,
    schema: options.schema,
    classify: options.classify,
  };
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
    description: options.description,
  };
}

/**
 * Declare a files store.
 *
 * @param name - Bucket name
 * @param options - Options
 */
export function files(
  name: string,
  options: FilesStoreOptions = {},
): FilesStoreDecl {
  return {
    facet: "files",
    name,
    ref: `files:${name}`,
    description: options.description,
  };
}

/**
 * Declare a vector index store.
 *
 * @param name - Index name
 * @param options - Dimensions
 */
export function index(
  name: string,
  options: IndexStoreOptions = {},
): IndexStoreDecl {
  return {
    facet: "index",
    name,
    ref: `index:${name}`,
    dims: options.dims,
  };
}

/** Public `store` element — four facets. */
export const store = {
  sql,
  kv,
  files,
  index,
} as const;
