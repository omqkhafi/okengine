/**
 * SQL resource-ref naming — the one place both the compiler's AST-based
 * effect inference ({@link "../compiler/effects-infer.ts"}) and the
 * kernel's capability gate ({@link "../kernel/fx.ts"} `gatedSqlHandle`)
 * compute a per-table `sql:<table>` ref, so the two cannot silently
 * drift apart again.
 *
 * Table-name *resolution* differs by nature — the compiler reads a static
 * AST identifier (or, better, the declared name behind a
 * `store.schema.table(name, …)` binding); the kernel reads the declared
 * name straight off the live table object at call time. Only the
 * naming/formatting step is shared here; that is the part a second,
 * independently-written implementation could get wrong.
 */

import type { ResourceRef } from "./types.ts";

/**
 * The declared name a real `store.schema.table(name, columns)` object
 * carries at runtime — the same string that was the first argument to
 * `store.schema.table(...)` in source, regardless of what the JS binding
 * is called. A column named `name` shadows `table.name`; prefer
 * non-enumerable `tableName`. `undefined` for anything else (raw ORM
 * tables, plain objects, missing/optional table arguments).
 *
 * @param value - Value passed where a table argument is expected
 */
export function schemaTableName(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as {
    kind?: unknown;
    name?: unknown;
    tableName?: unknown;
    columns?: unknown;
  };
  if (v.kind !== "schema-table") return undefined;
  // `store.schema.table` copies columns onto the table object. A column
  // named `name` (teams, labels, cycles, …) shadows the SQL name — the
  // declare site stamps non-enumerable `tableName` for this case.
  if (typeof v.tableName === "string") return v.tableName;
  if (typeof v.name === "string") return v.name;
  if (v.columns && typeof v.columns === "object") {
    for (const col of Object.values(v.columns as Record<string, { tableName?: unknown }>)) {
      if (typeof col?.tableName === "string") return col.tableName;
    }
  }
  return undefined;
}

/**
 * `sql:<table>` resource ref for a declared table name.
 *
 * @param table - Declared table name
 */
export function sqlTableRef(table: string): ResourceRef {
  return `sql:${table}` as ResourceRef;
}
