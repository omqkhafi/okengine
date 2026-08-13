/**
 * Manifest SQL table columns → SchemaFields descriptors.
 */

import type {
  ColumnClassification,
  DeclaredColumn,
  Manifest,
  Table,
} from "../../../../../../manifest/types.ts";
import type { FormField } from "@/features/units/lib/fields-from-schema.ts";

/**
 * Derive {@link FormField} rows from a Manifest SQL table declaration.
 *
 * @param manifest - Current Manifest (or null)
 * @param storeName - Manifest store map key (e.g. `db`)
 * @param tableName - Table / child name (e.g. `bookings`)
 * @param columnDescriptions - Optional descriptions from the store list child
 */
export function fieldsFromTable(
  manifest: Manifest | null,
  storeName: string,
  tableName: string,
  columnDescriptions?: Readonly<Record<string, string>>,
): FormField[] {
  const table = manifest?.stores?.[storeName]?.tables?.[tableName];
  if (!table?.columns) return [];
  return fieldsFromTableColumns(table.columns, columnDescriptions);
}

/**
 * Map a table column map to form fields.
 *
 * @param columns - Manifest table.columns
 * @param columnDescriptions - Optional overrides from list projection
 */
export function fieldsFromTableColumns(
  columns: NonNullable<Table["columns"]>,
  columnDescriptions?: Readonly<Record<string, string>>,
): FormField[] {
  return Object.entries(columns).map(([name, col]) =>
    fieldFromColumn(name, col, columnDescriptions?.[name]),
  );
}

function fieldFromColumn(
  name: string,
  col: DeclaredColumn | ColumnClassification,
  descriptionOverride?: string,
): FormField {
  const declared = isDeclaredColumn(col) ? col : null;
  const type =
    declared?.type === "integer" ? "integer" : declared?.type === "text" ? "string" : "unknown";
  const required = declared?.nullable === false || declared?.primaryKey === true;
  const description =
    descriptionOverride ??
    (typeof declared?.description === "string" ? declared.description : undefined);
  return {
    path: `/${name}`,
    name,
    type,
    required,
    ...(description !== undefined ? { description } : {}),
    ...(col.pii === true ? { pii: true } : {}),
    ...(col.sensitive === true ? { sensitive: true } : {}),
    ...(declared?.primaryKey === true ? { primaryKey: true } : {}),
  };
}

function isDeclaredColumn(col: DeclaredColumn | ColumnClassification): col is DeclaredColumn {
  return (
    "type" in col ||
    "nullable" in col ||
    "primaryKey" in col ||
    "unique" in col ||
    "sqlName" in col ||
    "description" in col ||
    "references" in col ||
    "default" in col
  );
}
