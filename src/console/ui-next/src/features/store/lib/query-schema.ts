/**
 * Manifest + store-list schema catalog for the query console (rail + complete).
 */

import type { Manifest } from "../../../../../../manifest/types.ts";
import { expandPiiNames } from "../../../../../../elements/store/classify.ts";
import type { StoreListChild, StoreListStore } from "@/client.ts";
import type { FormField } from "@/features/units/lib/fields-from-schema.ts";
import { fieldsFromTable } from "./fields-from-table.ts";
import { schemaGraphTables } from "./schema-graph.ts";
import { isSqlCatalogChild } from "./sql-catalog.ts";

/** One column in the query-console schema catalog. */
export type QuerySchemaColumn = {
  readonly name: string;
  readonly type: string;
  readonly pii?: boolean;
  readonly primaryKey?: boolean;
  readonly unique?: boolean;
  readonly references?: { readonly table: string; readonly column?: string };
  readonly inferredRef?: boolean;
};

/** One table / namespace in the query-console schema catalog. */
export type QuerySchemaTable = {
  readonly name: string;
  readonly columns: readonly QuerySchemaColumn[];
};

/**
 * Columns for a store child — Manifest table first, then list projection.
 *
 * @param store - Projected store
 * @param child - Table / namespace
 * @param manifest - Current Manifest
 */
export function schemaColumnsForChild(
  store: StoreListStore | null | undefined,
  child: StoreListChild,
  manifest: Manifest | null,
): FormField[] {
  if (store) {
    const fromManifest = fieldsFromTable(
      manifest,
      store.name,
      child.name,
      child.columnDescriptions,
    );
    if (fromManifest.length > 0) return fromManifest;
  }
  const pii = expandPiiNames(child.piiColumns);
  const names = [...new Set([...Object.keys(child.columnDescriptions), ...child.piiColumns])];
  return names.map((name) => ({
    path: `/${name}`,
    name,
    type: "unknown" as const,
    required: false,
    ...(child.columnDescriptions[name] !== undefined
      ? { description: child.columnDescriptions[name] }
      : {}),
    ...(pii.has(name) ? { pii: true } : {}),
  }));
}

/**
 * Infer value fields from KV samples (union of object keys).
 *
 * @param values - Stored values
 */
export function fieldsFromKvValues(values: readonly unknown[]): readonly QuerySchemaColumn[] {
  const types = new Map<string, string>();
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const [key, cell] of Object.entries(value)) {
      if (!types.has(key)) types.set(key, kvFieldType(cell));
    }
  }
  return [...types.entries()].map(([name, type]) => ({ name, type }));
}

function kvFieldType(value: unknown): string {
  if (value === null || value === undefined) return "unknown";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  return "unknown";
}

/**
 * Tables (or KV namespaces) the editor can complete against.
 *
 * @param store - Selected store
 * @param manifest - Current Manifest
 */
export function querySchemaTables(
  store: StoreListStore | null | undefined,
  manifest: Manifest | null,
): readonly QuerySchemaTable[] {
  if (!store) return [];
  const graphByName = new Map(
    store.facet === "sql"
      ? schemaGraphTables([store], manifest).map((table) => [table.name, table] as const)
      : [],
  );
  return store.children
    .filter((child) => !isSqlCatalogChild(child))
    .map((child) => ({
      name: child.name,
      columns: schemaColumnsForChild(store, child, manifest).map((col) => {
        const graphCol = graphByName.get(child.name)?.columns.find((c) => c.name === col.name);
        return {
          name: col.name,
          type: col.type,
          ...(col.pii === true ? { pii: true } : {}),
          ...(col.primaryKey === true || graphCol?.primaryKey === true ? { primaryKey: true } : {}),
          ...(graphCol?.unique === true ? { unique: true } : {}),
          ...(graphCol?.references
            ? {
                references: graphCol.references,
                ...(graphCol.inferredRef === true ? { inferredRef: true } : {}),
              }
            : {}),
        };
      }),
    }));
}
