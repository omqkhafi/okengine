/**
 * Lightweight table handles for the sql facet.
 *
 * Drizzle table objects are accepted via duck-typing when the peer is present;
 * this module never imports `drizzle-orm` so it stays unbundled.
 */

import type { ColumnClassification } from "../../manifest/types.ts";
import { okid } from "../../okid.ts";

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
  columns: Readonly<Record<string, ColumnDef | ColumnClassification | true | undefined>>,
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

/** One introspected column (TableHandle or Drizzle). */
export interface ResolvedColumn {
  /** JS / object key (e.g. `createdAt`). */
  readonly key: string;
  /** Database column name (e.g. `created_at`). */
  readonly sqlName: string;
  /** Whether this column is the primary key. */
  readonly primary: boolean;
  /** Unparameterized Postgres DDL type for auto-DDL (`CREATE TABLE`). */
  readonly sqlType:
    | "TEXT"
    | "INTEGER"
    | "BIGINT"
    | "REAL"
    | "DOUBLE PRECISION"
    | "NUMERIC"
    | "BOOLEAN"
    | "JSONB"
    | "BYTEA"
    | "POINT"
    | "LINE"
    | "TIMESTAMP"
    | "DATE"
    | "BLOB";
  /** Optional `$defaultFn` from Drizzle. */
  readonly defaultFn?: () => unknown;
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
    if (t.kind === "schema-table") {
      if (typeof t.tableName === "string") return t.tableName;
      if (typeof t.name === "string") return t.name;
      const cols = t.columns;
      if (cols && typeof cols === "object") {
        for (const col of Object.values(cols as Record<string, { tableName?: unknown }>)) {
          if (typeof col?.tableName === "string") return col.tableName;
        }
      }
    }
    if (typeof t.name === "string" && !isDrizzleTable(t)) return t.name;
    // Drizzle stores the name on an internal symbol; also expose via _.name / [Symbol]
    for (const key of Object.getOwnPropertySymbols(t)) {
      const val = (t as Record<symbol, unknown>)[key];
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

/**
 * True when `table` looks like a Drizzle table object.
 *
 * @param t - Candidate
 */
export function isDrizzleTable(t: Record<string, unknown>): boolean {
  if ("columns" in t && t.columns && typeof t.columns === "object") {
    // okengine TableHandle
    return false;
  }
  for (const key of Object.getOwnPropertySymbols(t)) {
    if (String(key).includes("IsDrizzleTable")) {
      return (t as Record<symbol, unknown>)[key] === true;
    }
  }
  return ("$" in t || "_" in t) && !("columns" in t);
}

/**
 * Unparameterized Postgres DDL type for an abstract {@link FieldSqlType}.
 *
 * Mirrors each type's drizzle `getSQLType()` output minus parameters — the
 * memory driver's `CREATE TABLE` parser comma-splits column defs, so
 * `numeric(p, s)` parens are never emitted here. Precision/length remain
 * migration-time concerns via drizzle-kit reading the emitted schema.
 *
 * @param sqlType - Declared SQL type primitive
 */
export function ddlTypeOf(sqlType: string): ResolvedColumn["sqlType"] {
  switch (sqlType) {
    case "smallint":
    case "smallserial":
      return "INTEGER";
    case "integer":
    case "bigint":
    case "serial":
    case "bigserial":
      // Abstract integer (ms clocks) and int8 family widen to BIGINT.
      return "BIGINT";
    case "real":
      return "REAL";
    case "doublePrecision":
      return "DOUBLE PRECISION";
    case "numeric":
      return "NUMERIC";
    case "boolean":
      return "BOOLEAN";
    case "json":
    case "jsonb":
      // jsonb chosen for indexability; auto-DDL is a dev-only convenience.
      return "JSONB";
    case "bytea":
      return "BYTEA";
    case "point":
      return "POINT";
    case "line":
      return "LINE";
    case "timestamp":
      return "TIMESTAMP";
    case "date":
      return "DATE";
    case "BLOB":
      return "BLOB";
    default:
      // text · varchar · char · uuid · time · interval · inet/cidr/mac* — text-shaped.
      return "TEXT";
  }
}

/**
 * Introspect columns from a TableHandle or Drizzle table.
 *
 * @param table - Table-like value
 */
export function resolveColumns(table: unknown): ResolvedColumn[] {
  if (table && typeof table === "object") {
    const t = table as Record<string, unknown>;
    if ("columns" in t && t.columns && typeof t.columns === "object") {
      return Object.entries(
        t.columns as Record<
          string,
          ColumnDef & {
            sqlName?: string;
            sqlType?: string;
            primaryKey?: boolean;
            defaultFn?: () => unknown;
          }
        >,
      ).map(([key, col]) => {
        const sqlName = col.sqlName ?? col.name;
        const primary =
          typeof col.primaryKey === "boolean"
            ? col.primaryKey
            : col.name === "id" || key === "id" || sqlName === "id";
        return {
          key,
          sqlName,
          primary,
          sqlType: ddlTypeOf(col.sqlType ?? ""),
          ...(typeof col.defaultFn === "function" ? { defaultFn: col.defaultFn } : {}),
        };
      });
    }
    if (isDrizzleTable(t)) {
      return drizzleColumns(t);
    }
  }
  return [];
}

function drizzleColumns(t: Record<string, unknown>): ResolvedColumn[] {
  let cols: Record<string, unknown> | undefined;
  for (const key of Object.getOwnPropertySymbols(t)) {
    if (String(key).includes("Columns") && !String(key).includes("Extra")) {
      const val = (t as Record<symbol, unknown>)[key];
      if (val && typeof val === "object") {
        cols = val as Record<string, unknown>;
        break;
      }
    }
  }
  if (!cols) {
    // Fallback: own enumerable column keys on the table object.
    cols = {};
    for (const [key, val] of Object.entries(t)) {
      if (val && typeof val === "object" && "name" in (val as object)) {
        cols[key] = val;
      }
    }
  }
  const out: ResolvedColumn[] = [];
  for (const [key, raw] of Object.entries(cols)) {
    if (!raw || typeof raw !== "object") continue;
    const col = raw as {
      name?: string;
      primary?: boolean;
      columnType?: string;
      dataType?: string;
      defaultFn?: () => unknown;
      config?: { primaryKey?: boolean };
    };
    const sqlName = typeof col.name === "string" ? col.name : key;
    const primary = Boolean(col.primary || col.config?.primaryKey || sqlName === "id");
    const sqlType = drizzleSqlType(col.columnType, col.dataType);
    out.push({
      key,
      sqlName,
      primary,
      sqlType,
      ...(typeof col.defaultFn === "function" ? { defaultFn: col.defaultFn.bind(col) } : {}),
    });
  }
  return out;
}

function drizzleSqlType(
  columnType: string | undefined,
  dataType: string | undefined,
): ResolvedColumn["sqlType"] {
  const ct = (columnType ?? "").toLowerCase();
  const dt = (dataType ?? "").toLowerCase();
  if (ct.includes("bigint") || dt.includes("bigint")) return "BIGINT";
  if (ct.includes("smallint")) return "INTEGER";
  if (ct.includes("int") || dt.includes("int") || dt.includes("number")) return "INTEGER";
  if (dt.includes("boolean") || ct.includes("bool")) return "BOOLEAN";
  if (ct.includes("jsonb")) return "JSONB";
  if (ct.includes("json")) return "JSONB";
  if (ct.includes("bytea") || dt.includes("buffer")) return "BYTEA";
  if (ct.includes("double precision")) return "DOUBLE PRECISION";
  if (ct.includes("real") || dt.includes("float")) return "REAL";
  if (ct.includes("numeric")) return "NUMERIC";
  if (ct.includes("timestamp")) return "TIMESTAMP";
  if (ct.startsWith("date")) return "DATE";
  if (ct.includes("blob")) return "BLOB";
  return "TEXT";
}

/**
 * Map a JS-keyed row to SQL column names; apply Drizzle `$defaultFn`s.
 *
 * @param table - Table-like value
 * @param row - Incoming values (JS keys)
 */
export function prepareInsertRow(
  table: unknown,
  row: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const cols = resolveColumns(table);
  if (cols.length === 0) return { ...row };
  const out: Record<string, unknown> = {};
  const byKey = new Map(cols.map((c) => [c.key, c]));
  const bySql = new Map(cols.map((c) => [c.sqlName, c]));

  for (const col of cols) {
    let value: unknown;
    if (col.key in row) value = row[col.key];
    else if (col.sqlName in row) value = row[col.sqlName];
    else if (col.defaultFn) value = col.defaultFn();
    else continue;
    out[col.sqlName] = value;
  }
  // Pass through unknown keys as-is (already SQL names).
  for (const [k, v] of Object.entries(row)) {
    if (byKey.has(k) || bySql.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Map a JS-keyed partial row to SQL column names for `UPDATE … SET`.
 * Unlike {@link prepareInsertRow}, `$defaultFn`s are never applied — column
 * defaults are insert physics, not update physics.
 *
 * @param table - Table-like value
 * @param row - Incoming values (JS keys)
 */
export function prepareUpdateRow(
  table: unknown,
  row: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const cols = resolveColumns(table);
  if (cols.length === 0) return { ...row };
  const byKey = new Map(cols.map((c) => [c.key, c]));
  const bySql = new Map(cols.map((c) => [c.sqlName, c]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const col = byKey.get(k) ?? bySql.get(k);
    out[col?.sqlName ?? k] = v;
  }
  return out;
}

/**
 * Map a SQL-keyed driver row to declared JS field names only.
 *
 * When Drizzle/TableHandle metadata exists, the result contains exactly the
 * table's declared keys (`createdAt`) — never the raw SQL names
 * (`created_at`) alongside or instead of them. Without metadata, the row is
 * returned as-is (opaque / raw SQL).
 *
 * @param table - Table-like value
 * @param row - Driver row (SQL column names, or already JS-keyed)
 */
export function mapRowToJs(
  table: unknown,
  row: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const cols = resolveColumns(table);
  if (cols.length === 0) return { ...row };
  const out: Record<string, unknown> = {};
  for (const col of cols) {
    if (col.key in row) out[col.key] = row[col.key];
    else if (col.sqlName in row) out[col.key] = row[col.sqlName];
  }
  return out;
}

/**
 * Extract classifications from a {@link TableHandle}.
 *
 * @param table - Table handle
 */
export function classificationsFromTable(table: TableHandle): Record<string, ColumnClassification> {
  const out: Record<string, ColumnClassification> = {};
  for (const [key, col] of Object.entries(table.columns)) {
    if (!col.classification) continue;
    out[key] = col.classification;
    const sqlName =
      "sqlName" in col && typeof (col as { sqlName?: unknown }).sqlName === "string"
        ? (col as { sqlName: string }).sqlName
        : col.name;
    if (sqlName && sqlName !== key) out[sqlName] = col.classification;
  }
  return out;
}

/**
 * Generate a unique id (21-char OKID, 126-bit entropy). Suitable for
 * `$defaultFn(id)` in schemas.
 */
export function id(): string {
  return okid();
}

/**
 * Current epoch-ms. Suitable for `$defaultFn(now)` in schemas (number columns).
 */
export function now(): number {
  return Date.now();
}

/**
 * Current instant as an ISO-8601 string. The resolved default for `.now()` on
 * string-typed temporal columns (`timestamp` / `date` in string mode).
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Current instant as a `Date`. The resolved default for `.now()` on temporal
 * columns declared with `{ mode: "date" }`.
 */
export function nowDate(): Date {
  return new Date();
}
