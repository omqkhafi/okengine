/**
 * Store browse → grid row/column model (facet-aware).
 */

import type { StoreQueryResult } from "@/client.ts";

/** One normalized grid row. */
export interface StoreGridRow {
  /** Stable row id (SQL id / KV key / Files key / Index hit id). */
  readonly id: string;
  /** Column key → raw value (SQL) or `key`/`value` (KV/Files) / `id`/`score`/`meta` (Index). */
  readonly cells: Readonly<Record<string, unknown>>;
}

/** Column descriptor for the grid. */
export interface StoreGridColumn {
  readonly key: string;
  /** FormField-ish type used for cell variant + badge. */
  readonly type: "string" | "integer" | "json" | "number";
  /** Whether the column is editable in place. */
  readonly editable: boolean;
  /** Whether the column is PII-masked (SQL only). */
  readonly pii: boolean;
  /** Whether the column is the Manifest primary key (SQL only). */
  readonly primaryKey?: boolean;
  /** Optional description from Manifest. */
  readonly description?: string;
}

/** Normalized grid model. */
export interface StoreGridModel {
  readonly columns: readonly StoreGridColumn[];
  readonly rows: readonly StoreGridRow[];
  /** Facet delete key kind (`ids` for SQL/Index, `keys` for KV/Files). */
  readonly deleteKind: "ids" | "keys";
  /** Whether any row supports edit. */
  readonly editable: boolean;
}

/** Options for building a model. */
export interface StoreGridModelOptions {
  readonly facet: "sql" | "kv" | "files" | "index";
  readonly data: StoreQueryResult;
  readonly piiColumns?: readonly string[];
  readonly columnTypes?: Readonly<Record<string, "text" | "integer">>;
  readonly columnDescriptions?: Readonly<Record<string, string>>;
  /** Manifest primary-key column names (SQL only). */
  readonly primaryKeyColumns?: readonly string[];
}

/**
 * Build a grid model from a browse result.
 *
 * @param options - Facet + browse payload + Manifest column metadata
 */
export function buildStoreGridModel(options: StoreGridModelOptions): StoreGridModel {
  const {
    facet,
    data,
    piiColumns = [],
    columnTypes = {},
    columnDescriptions = {},
    primaryKeyColumns = [],
  } = options;
  const pii = new Set(piiColumns);
  const primaryKeys = new Set(primaryKeyColumns);

  if (facet === "sql") {
    const rows = data.rows ?? [];
    const columnKeys = rows.length > 0 ? Object.keys(rows[0] ?? {}) : Object.keys(columnTypes);
    const columns: StoreGridColumn[] = columnKeys.map((key) => ({
      key,
      type: columnTypes[key] === "integer" ? "integer" : "string",
      editable: key !== "id",
      pii: pii.has(key),
      ...(primaryKeys.has(key) ? { primaryKey: true } : {}),
      ...(columnDescriptions[key] !== undefined ? { description: columnDescriptions[key] } : {}),
    }));
    return {
      columns,
      rows: rows.map((row) => ({
        id: sqlRowId(row),
        cells: row,
      })),
      deleteKind: "ids",
      editable: true,
    };
  }

  if (facet === "kv") {
    const keys = data.keys ?? [];
    return {
      columns: [
        { key: "key", type: "string", editable: false, pii: false },
        { key: "value", type: "json", editable: true, pii: false },
      ],
      rows: keys.map((entry) => ({
        id: entry.key,
        cells: { key: entry.key, value: entry.value },
      })),
      deleteKind: "keys",
      editable: true,
    };
  }

  if (facet === "files") {
    const keys = data.keys ?? [];
    return {
      columns: [
        { key: "key", type: "string", editable: false, pii: false },
        { key: "warnings", type: "string", editable: false, pii: false },
      ],
      rows: keys.map((entry) => ({
        id: entry.key,
        cells: {
          key: entry.key,
          warnings: entry.warnings?.map((w) => w.message).join("; ") ?? "",
        },
      })),
      deleteKind: "keys",
      editable: false,
    };
  }

  const hits = data.hits ?? [];
  return {
    columns: [
      { key: "id", type: "string", editable: false, pii: false },
      { key: "score", type: "number", editable: false, pii: false },
      { key: "meta", type: "json", editable: false, pii: false },
    ],
    rows: hits.map((hit) => ({
      id: hit.id,
      cells: { id: hit.id, score: hit.score, meta: hit.meta },
    })),
    deleteKind: "ids",
    editable: false,
  };
}

/** Extract a stable SQL row id (`id` / `Id`). */
export function sqlRowId(row: Readonly<Record<string, unknown>>): string {
  const raw = row.id ?? row.Id;
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  return "";
}

/** Format a cell value for display. */
export function formatGridCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}
