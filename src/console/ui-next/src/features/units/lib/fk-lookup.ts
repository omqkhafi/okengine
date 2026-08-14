/**
 * Resolve a Call API foreign-key field onto a Store SQL table + column.
 */

import type { DeclaredColumn, Manifest, Table } from "../../../../../../manifest/types.ts";
import type { FormField } from "./fields-from-schema.ts";

/** Browse target for FK options. */
export type FkLookup = {
  readonly ref: string;
  readonly child: string;
  readonly column: string;
  readonly labelColumn?: string;
};

/** One selectable FK value. */
export type FkOption = {
  readonly value: string;
  readonly label: string;
};

/**
 * Map a FK field onto `sql:<store>` + table + value column.
 *
 * Uses `references` when declared; otherwise `teamKey` → `teams.key`,
 * `userId` → `users.id` (or the table PK).
 *
 * @param field - Contract field
 * @param manifest - Live Manifest
 */
export function resolveFkLookup(
  field: FormField,
  manifest: Manifest | null,
): FkLookup | null {
  if (!field.foreignKey || !manifest) return null;
  const stores = sqlStores(manifest);
  if (stores.length === 0) return null;

  if (field.references?.table) {
    const hit = findTable(stores, field.references.table);
    if (!hit) return null;
    const column = field.references.column ?? pkColumn(hit.table) ?? "id";
    return lookupOf(hit, column);
  }

  const parsed = parseFkName(field.name);
  if (!parsed) return null;
  const hit = findTableByStem(stores, parsed.stem);
  if (!hit) return null;
  const column =
    parsed.kind === "key"
      ? (columnIfExists(hit.table, "key") ?? pkColumn(hit.table) ?? "id")
      : (pkColumn(hit.table) ?? "id");
  return lookupOf(hit, column);
}

/**
 * Distinct options from browse rows.
 *
 * @param rows - Store query rows
 * @param lookup - Resolved target
 */
export function fkOptionsFromRows(
  rows: readonly Readonly<Record<string, unknown>>[],
  lookup: FkLookup | null,
): readonly FkOption[] {
  if (!lookup) return [];
  const seen = new Set<string>();
  const out: FkOption[] = [];
  for (const row of rows) {
    const raw = row[lookup.column];
    if (raw == null) continue;
    const value = String(raw);
    if (seen.has(value)) continue;
    seen.add(value);
    const labelRaw = lookup.labelColumn ? row[lookup.labelColumn] : undefined;
    const extra = labelRaw != null && String(labelRaw) !== value ? String(labelRaw) : null;
    out.push({ value, label: extra ? `${value} · ${extra}` : value });
  }
  return out;
}

function lookupOf(
  hit: { readonly ref: string; readonly name: string; readonly table: Table },
  column: string,
): FkLookup {
  const label = labelColumn(hit.table, column);
  return {
    ref: hit.ref,
    child: hit.name,
    column,
    ...(label !== undefined ? { labelColumn: label } : {}),
  };
}

function parseFkName(name: string): { readonly stem: string; readonly kind: "id" | "key" } | null {
  if (name === "id") return null;
  if (name.endsWith("Id")) return { stem: name.slice(0, -2), kind: "id" };
  if (name.endsWith("_id")) return { stem: name.slice(0, -3), kind: "id" };
  if (name.endsWith("Key")) return { stem: name.slice(0, -3), kind: "key" };
  if (name.endsWith("_key")) return { stem: name.slice(0, -4), kind: "key" };
  return null;
}

function sqlStores(manifest: Manifest): readonly {
  readonly ref: string;
  readonly tables: Readonly<Record<string, Table>>;
}[] {
  const out: { ref: string; tables: Readonly<Record<string, Table>> }[] = [];
  for (const [name, store] of Object.entries(manifest.stores ?? {})) {
    if (store.facet !== "sql" || !store.tables) continue;
    out.push({ ref: `sql:${name}`, tables: store.tables });
  }
  return out;
}

function findTable(
  stores: readonly { readonly ref: string; readonly tables: Readonly<Record<string, Table>> }[],
  tableName: string,
): { readonly ref: string; readonly name: string; readonly table: Table } | null {
  const needle = tableName.toLowerCase();
  for (const store of stores) {
    for (const [name, table] of Object.entries(store.tables)) {
      if (name.toLowerCase() === needle) return { ref: store.ref, name, table };
    }
  }
  return null;
}

function findTableByStem(
  stores: readonly { readonly ref: string; readonly tables: Readonly<Record<string, Table>> }[],
  stem: string,
): { readonly ref: string; readonly name: string; readonly table: Table } | null {
  const snake = camelToSnake(stem);
  const candidates = [stem, snake, pluralizeSqlName(stem), pluralizeSqlName(snake)].map((n) =>
    n.toLowerCase(),
  );
  for (const store of stores) {
    for (const [name, table] of Object.entries(store.tables)) {
      if (candidates.includes(name.toLowerCase())) return { ref: store.ref, name, table };
    }
  }
  return null;
}

function pkColumn(table: Table): string | undefined {
  for (const [name, col] of Object.entries(table.columns ?? {})) {
    if (isDeclared(col) && col.primaryKey === true) return name;
  }
  if (table.columns && "id" in table.columns) return "id";
  return undefined;
}

function columnIfExists(table: Table, name: string): string | undefined {
  return table.columns && name in table.columns ? name : undefined;
}

function labelColumn(table: Table, valueColumn: string): string | undefined {
  if (valueColumn !== "name" && table.columns && "name" in table.columns) return "name";
  return undefined;
}

function isDeclared(col: DeclaredColumn | { pii?: boolean }): col is DeclaredColumn {
  return "type" in col || "primaryKey" in col || "references" in col;
}

function pluralizeSqlName(stem: string): string {
  if (stem.endsWith("y") && !/[aeiou]y$/i.test(stem)) return `${stem.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(stem)) return `${stem}es`;
  return `${stem}s`;
}

function camelToSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}
