/**
 * PII / sensitivity classification — lives in the schema, enforced at the
 * driver boundary so it survives raw SQL (`SELECT *` masks classified columns).
 */

import type { ColumnClassification } from "../../manifest/types.ts";
import { classificationKey, type ClassificationMap, type SqlRow } from "../../drivers/types.ts";

/** Default mask token for PII columns when reveal is denied. */
export const PII_MASK = "[redacted]";

/**
 * Tag a column (or field) with privacy / retention classification.
 *
 * Use in schema metadata or `store.sql` classify maps:
 * `email: classify({ pii: true })`.
 *
 * @param classification - Tags to attach
 */
export function classify(classification: ColumnClassification): ColumnClassification {
  return { ...classification };
}

/**
 * Build a classification map from a nested table → column → tags structure.
 *
 * @param tables - Per-table column classifications
 */
export function buildClassificationMap(
  tables: Readonly<Record<string, Readonly<Record<string, ColumnClassification>>>>,
): ClassificationMap {
  const map = new Map<string, ColumnClassification>();
  for (const [table, cols] of Object.entries(tables)) {
    for (const [column, tags] of Object.entries(cols)) {
      map.set(classificationKey(table, column), tags);
    }
  }
  return map;
}

/**
 * Whether a column is classified as PII.
 *
 * @param map - Classification map
 * @param table - Table name (may be unknown for opaque queries)
 * @param column - Column name
 */
export function isPiiColumn(
  map: ClassificationMap,
  table: string | undefined,
  column: string,
): boolean {
  if (table) {
    const direct = map.get(classificationKey(table, column));
    if (direct?.pii) return true;
  }
  // Survive raw SQL when only the column name is known: match any table.
  for (const [key, tags] of map) {
    if (tags.pii && key.endsWith(`.${column}`)) return true;
  }
  return false;
}

/** Options for {@link maskRows}. */
export interface MaskRowsOptions {
  /** Classification map from the schema. */
  readonly classifications: ClassificationMap;
  /** Table hint when known (from query builder). */
  readonly table?: string;
  /**
   * When true, PII columns are returned in cleartext (requires `pii:reveal`).
   * Default false.
   */
  readonly revealPii?: boolean;
  /** Mask token (defaults to {@link PII_MASK}). */
  readonly mask?: string;
}

/**
 * Mask classified columns on result rows at the driver boundary.
 *
 * @param rows - Raw driver rows
 * @param options - Classification + reveal policy
 */
export function maskRows(rows: readonly SqlRow[], options: MaskRowsOptions): SqlRow[] {
  if (options.revealPii || options.classifications.size === 0) {
    return rows.map((r) => ({ ...r }));
  }
  const mask = options.mask ?? PII_MASK;
  return rows.map((row) => {
    const out: SqlRow = {};
    for (const [column, value] of Object.entries(row)) {
      out[column] = isPiiColumn(options.classifications, options.table, column) ? mask : value;
    }
    return out;
  });
}

/**
 * Extract a FROM table name from a SQL string when possible.
 * Best-effort — used so `SELECT *` still finds classifications.
 *
 * @param sql - SQL text
 */
export function tableFromSql(sql: string): string | undefined {
  const match = /\bfrom\s+["`]?([a-zA-Z_][a-zA-Z0-9_]*)["`]?/i.exec(sql);
  return match?.[1];
}
