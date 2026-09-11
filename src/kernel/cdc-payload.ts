/**
 * CDC flow payload — `{ before, after }` plus additive `table` / `action` / `id`.
 *
 * PK lookup reuses the Manifest `DeclaredColumn.primaryKey` walk already proven
 * by search-embed (not `resolvePkColumn`'s `"id"`/`"code"` heuristics).
 */

import type { DeclaredColumn, Manifest, Table } from "../manifest/types.ts";

/** Insert / update / delete derived from before/after presence. */
export type CdcAction = "created" | "updated" | "deleted";

/** Payload for a CDC invocation. */
export interface CdcPayload {
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly table: string;
  readonly action: CdcAction;
  readonly id: string | number;
}

/**
 * Images-only (or partially enriched) input accepted by {@link dispatchCdc}.
 * Missing `table` / `action` / `id` are filled in before the Flow runs.
 */
export type CdcPayloadInput = Pick<CdcPayload, "before" | "after"> &
  Partial<Pick<CdcPayload, "table" | "action" | "id">>;

/** JS key + SQL name for a declared primary-key column. */
export interface DeclaredPk {
  readonly key: string;
  readonly sqlName: string;
}

const DEFAULT_PK: DeclaredPk = { key: "id", sqlName: "id" };

/**
 * Declared PK from a Manifest table column map.
 * `primaryKey: true` wins; otherwise `"id"` (CDC does not require a PK).
 *
 * @param columns - Manifest `tables.*.columns`
 */
export function declaredPk(columns: Table["columns"] | undefined): DeclaredPk {
  for (const [key, col] of Object.entries(columns ?? {})) {
    if (!col || typeof col !== "object") continue;
    const c = col as DeclaredColumn;
    if (c.primaryKey === true) return { key, sqlName: c.sqlName ?? key };
  }
  return DEFAULT_PK;
}

/**
 * SQL name of the declared PK (search-embed SQL `WHERE` uses this).
 *
 * @param columns - Manifest `tables.*.columns`
 */
export function declaredPkColumn(columns: Table["columns"] | undefined): string {
  return declaredPk(columns).sqlName;
}

/**
 * Table name → declared PK for every SQL table in the Manifest.
 *
 * @param manifest - Compiled Manifest (optional)
 */
export function pkColumnByTableFromManifest(
  manifest: Pick<Manifest, "stores"> | undefined,
): ReadonlyMap<string, DeclaredPk> {
  const out = new Map<string, DeclaredPk>();
  for (const store of Object.values(manifest?.stores ?? {})) {
    if (store.facet !== "sql" || !store.tables) continue;
    for (const [tableName, table] of Object.entries(store.tables)) {
      out.set(tableName, declaredPk(table.columns));
    }
  }
  return out;
}

/**
 * Derive action from row images. `before === null` → created; `after === null`
 * → deleted; otherwise updated. Not `event.op`.
 *
 * @param before - Prior row image
 * @param after - New row image
 */
export function cdcActionFromImages(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): CdcAction {
  if (before === null) return "created";
  if (after === null) return "deleted";
  return "updated";
}

function pkNames(pkColumn: string | DeclaredPk): DeclaredPk {
  return typeof pkColumn === "string" ? { key: pkColumn, sqlName: pkColumn } : pkColumn;
}

function asCdcId(raw: unknown): string | number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") return raw;
  return String(raw ?? "");
}

/**
 * Extract the PK value from the surviving image (`after` for created/updated,
 * `before` for deleted). Tries the JS key then the SQL name.
 *
 * @param before - Prior row image
 * @param after - New row image
 * @param pkColumn - Declared PK key and/or SQL name
 */
export function cdcIdFromImages(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  pkColumn: string | DeclaredPk,
): string | number {
  const { key, sqlName } = pkNames(pkColumn);
  const row = after ?? before;
  if (!row) return "";
  const raw = key in row ? row[key] : row[sqlName];
  return asCdcId(raw);
}

/**
 * Build the full CDC payload from table name, images, and the declared PK.
 *
 * @param tableName - Physical table name (`resolveTableName` / `dispatchCdc` arg)
 * @param before - Prior row image
 * @param after - New row image
 * @param pkColumn - Declared PK (Manifest) or a column name string
 */
export function enrichCdcPayload(
  tableName: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  pkColumn: string | DeclaredPk = DEFAULT_PK,
): CdcPayload {
  return {
    before,
    after,
    table: tableName,
    action: cdcActionFromImages(before, after),
    id: cdcIdFromImages(before, after, pkColumn),
  };
}
