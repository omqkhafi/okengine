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
  const type = formFieldType(declared);
  const required = declared?.nullable === false || declared?.primaryKey === true;
  const description =
    descriptionOverride ??
    (typeof declared?.description === "string" ? declared.description : undefined);
  return {
    path: `/${name}`,
    name,
    type,
    required,
    ...(declared?.enumValues !== undefined && declared.enumValues.length > 0
      ? { enumValues: [...declared.enumValues] }
      : {}),
    ...(description !== undefined ? { description } : {}),
    ...(col.pii === true ? { pii: true } : {}),
    ...(col.sensitive === true ? { sensitive: true } : {}),
    ...(declared?.primaryKey === true ? { primaryKey: true } : {}),
    ...(declared?.unique === true && declared.primaryKey !== true ? { unique: true } : {}),
    ...(declared?.references?.table
      ? {
          foreignKey: true,
          references: {
            table: declared.references.table,
            ...(declared.references.column !== undefined
              ? { column: declared.references.column }
              : {}),
          },
        }
      : {}),
  };
}

const NUMERIC_COLUMN_TYPES: ReadonlySet<NonNullable<DeclaredColumn["type"]>> = new Set([
  "smallint",
  "integer",
  "bigint",
  "serial",
  "smallserial",
  "bigserial",
  "real",
  "doublePrecision",
]);

/**
 * Map a declared SQL type to its form input physics.
 *
 * @param declared - Declared column (or null for bare classification)
 */
function formFieldType(declared: DeclaredColumn | null): FormField["type"] {
  const type = declared?.type;
  if (type === undefined) return "unknown";
  if (type === "boolean") return "boolean";
  if (NUMERIC_COLUMN_TYPES.has(type)) {
    // real/doublePrecision render as number; int family as integer steppers.
    return type === "real" || type === "doublePrecision" ? "number" : "integer";
  }
  if (type === "json" || type === "jsonb") return "object";
  // Everything else is text-shaped at the wire: text/varchar/char, temporals
  // in their default string mode, uuid, network family, point/line, bytea.
  if (type === "timestamp" || type === "date") return "string";
  if (type === "numeric") return "string";
  return "string";
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
