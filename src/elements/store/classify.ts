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
 * Each classified column is registered under both JS and SQL spellings
 * (`ownerEmail` / `owner_email`) so raw `SELECT *` and query-builder rows
 * hit the same tags.
 *
 * @param tables - Per-table column classifications
 */
export function buildClassificationMap(
  tables: Readonly<Record<string, Readonly<Record<string, ColumnClassification>>>>,
): ClassificationMap {
  const map = new Map<string, ColumnClassification>();
  for (const [table, cols] of Object.entries(tables)) {
    for (const [column, tags] of Object.entries(cols)) {
      for (const name of piiNameAliases(column)) {
        map.set(classificationKey(table, name), tags);
      }
    }
  }
  return map;
}

/**
 * JS and SQL spellings of a classified field (`ownerEmail` ↔ `owner_email`).
 *
 * Store rows remap to camelCase; Manifest extract / seed tables and raw
 * `SELECT *` often keep snake_case. Masking and Console PII flags must hit both.
 *
 * @param col - Column / field name
 */
export function piiNameAliases(col: string): readonly string[] {
  const names = [col];
  const snake = camelToSnake(col);
  const camel = snakeToCamel(col);
  if (snake !== col) names.push(snake);
  if (camel !== col) names.push(camel);
  return names;
}

/**
 * Register a classified field under both JS and SQL spellings.
 *
 * @param names - Accumulator
 * @param col - Column / field name from the Manifest or schema
 */
export function addPiiFieldName(names: Set<string>, col: string): void {
  for (const name of piiNameAliases(col)) names.add(name);
}

/**
 * Expand classified names so a Set lookup matches either spelling.
 *
 * @param cols - Manifest / list PII column names
 */
export function expandPiiNames(cols: Iterable<string>): Set<string> {
  const names = new Set<string>();
  for (const col of cols) addPiiFieldName(names, col);
  return names;
}

/**
 * Count distinct classified columns, treating JS / SQL spellings as one.
 *
 * @param cols - Manifest / list PII column names
 */
export function piiLogicalCount(cols: Iterable<string>): number {
  const seen = new Set<string>();
  for (const col of cols) seen.add(camelToSnake(col));
  return seen.size;
}

function camelToSnake(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Whether a column is classified as PII.
 *
 * Matches the given name and its camelCase / snake_case alias so a classify
 * map keyed `ownerEmail` still masks raw SQL `owner_email` (and the reverse).
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
  const names = piiNameAliases(column);
  if (table) {
    for (const name of names) {
      const direct = map.get(classificationKey(table, name));
      if (direct?.pii) return true;
    }
  }
  // Survive raw SQL when only the column name is known: match any table.
  for (const [key, tags] of map) {
    if (!tags.pii) continue;
    for (const name of names) {
      if (key.endsWith(`.${name}`)) return true;
    }
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
