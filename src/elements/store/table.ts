/**
 * Lightweight table handles for the sql facet.
 *
 * Drizzle table objects are accepted via duck-typing when the peer is present;
 * this module never imports `drizzle-orm` so it stays unbundled.
 */

import type { ColumnClassification } from "../../manifest/types.ts";

/** Column descriptor with optional classification. */
export interface ColumnDef {
  /** Column name in the database. */
  readonly name: string;
  /** Privacy / retention tags. */
  readonly classification?: ColumnClassification;
}

/** Table handle used by `fx.store(db).select().from(table)`. */
export interface TableHandle {
  /** Table name. */
  readonly name: string;
  /** Column descriptors. */
  readonly columns: Readonly<Record<string, ColumnDef>>;
}

/**
 * Define a table handle with optional per-column classification.
 *
 * @param name - Table name
 * @param columns - Column map (values may be `classify({ pii: true })` or full defs)
 */
export function defineTable(
  name: string,
  columns: Readonly<
    Record<string, ColumnDef | ColumnClassification | true | undefined>
  >,
): TableHandle {
  const resolved: Record<string, ColumnDef> = {};
  for (const [key, value] of Object.entries(columns)) {
    if (value === undefined || value === true) {
      resolved[key] = { name: key };
      continue;
    }
    if ("name" in value && typeof value.name === "string") {
      resolved[key] = value as ColumnDef;
      continue;
    }
    resolved[key] = {
      name: key,
      classification: value as ColumnClassification,
    };
  }
  return { name, columns: resolved };
}

/**
 * Resolve a table name from an okengine {@link TableHandle} or a Drizzle table.
 *
 * @param table - Table-like value
 */
export function resolveTableName(table: unknown): string {
  if (typeof table === "string") return table;
  if (table && typeof table === "object") {
    const t = table as Record<string, unknown>;
    if (typeof t.name === "string" && !isDrizzleInternal(t)) return t.name;
    // Drizzle stores the name on an internal symbol; also expose via _.name / [Symbol]
    for (const key of Object.getOwnPropertySymbols(t)) {
      const val = t[key as unknown as string];
      if (typeof val === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(val)) {
        return val;
      }
    }
    const underscore = t._;
    if (underscore && typeof underscore === "object") {
      const name = (underscore as { name?: unknown }).name;
      if (typeof name === "string") return name;
    }
  }
  throw new TypeError("Unable to resolve table name from value");
}

function isDrizzleInternal(t: Record<string, unknown>): boolean {
  // Plain TableHandle always has `columns`; drizzle tables do not.
  return !("columns" in t) && ("$" in t || "_" in t);
}

/**
 * Extract classifications from a {@link TableHandle}.
 *
 * @param table - Table handle
 */
export function classificationsFromTable(
  table: TableHandle,
): Record<string, ColumnClassification> {
  const out: Record<string, ColumnClassification> = {};
  for (const [key, col] of Object.entries(table.columns)) {
    if (col.classification) out[key] = col.classification;
  }
  return out;
}

/**
 * Generate a unique id (UUID). Suitable for `$defaultFn(id)` in schemas.
 */
export function id(): string {
  return crypto.randomUUID();
}

/**
 * Current epoch-ms. Suitable for `$defaultFn(now)` in schemas.
 */
export function now(): number {
  return Date.now();
}
