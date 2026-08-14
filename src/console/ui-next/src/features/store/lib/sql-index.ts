/**
 * CREATE INDEX starter, templates, and preview SQL for the Indexes sheet.
 */

import { isPgIdent, quotePgIdent } from "../../../../../../drivers/pg-rls.ts";

/** Index access method. */
export type SqlIndexMethod = "btree" | "hash" | "gin" | "gist" | "brin";

/** Fields for `CREATE INDEX`. */
export type SqlIndexSpec = {
  readonly name: string;
  readonly table: string;
  readonly columns: string;
  readonly method?: SqlIndexMethod;
  readonly unique?: boolean;
  readonly ifNotExists?: boolean;
  readonly where?: string;
  readonly concurrently?: boolean;
  readonly include?: string;
  readonly nullsNotDistinct?: boolean;
  readonly with?: string;
};

/** One starter template for the Create index sheet. */
export type SqlIndexTemplate = {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly columns: string;
  readonly method?: SqlIndexMethod;
  readonly unique?: boolean;
  readonly where?: string;
};

/** Common Postgres index starters. */
export const SQL_INDEX_TEMPLATES: readonly SqlIndexTemplate[] = [
  {
    id: "single-column",
    title: "Single column",
    detail: "B-tree on one column — the usual lookup index.",
    columns: "column_name",
  },
  {
    id: "unique",
    title: "Unique",
    detail: "UNIQUE B-tree — reject duplicate values.",
    columns: "column_name",
    unique: true,
  },
  {
    id: "partial",
    title: "Partial",
    detail: "B-tree with WHERE — index only matching rows.",
    columns: "column_name",
    where: "true",
  },
  {
    id: "gin",
    title: "GIN",
    detail: "USING gin — jsonb, arrays, and full-text.",
    columns: "column_name",
    method: "gin",
  },
];

/**
 * Pretty `CREATE INDEX` for the review editor.
 *
 * @param spec - Index fields
 */
export function buildCreateIndexSql(spec: SqlIndexSpec): string {
  const unique = spec.unique === true ? "UNIQUE " : "";
  const concurrently = spec.concurrently === true ? "CONCURRENTLY " : "";
  const ifNotExists = spec.ifNotExists === true ? "IF NOT EXISTS " : "";
  const method =
    spec.method !== undefined && spec.method !== "btree" ? ` USING ${spec.method}` : "";
  const lines = [
    `CREATE ${unique}INDEX ${concurrently}${ifNotExists}${quotePgIdent(spec.name)}`,
    `  ON ${quotePgIdent(spec.table)}${method}`,
    `  (${formatIndexColumns(spec.columns)})`,
  ];
  const include = spec.include?.trim() ?? "";
  if (include !== "" && isSafeIndexClause(include)) {
    lines.push(`  INCLUDE (${formatIndexColumns(include)})`);
  }
  if (spec.nullsNotDistinct === true) {
    lines.push("  NULLS NOT DISTINCT");
  }
  const storage = spec.with?.trim() ?? "";
  if (storage !== "" && isSafeIndexClause(storage)) {
    lines.push(`  WITH (${storage})`);
  }
  const where = spec.where?.trim() ?? "";
  if (where !== "" && isSafeIndexClause(where)) {
    lines.push(`  WHERE ${where}`);
  }
  return `${lines.join("\n")};`;
}

/**
 * Count of Advanced index knobs that are set.
 *
 * @param spec - Index fields
 */
export function sqlIndexAdvancedCount(
  spec: Pick<SqlIndexSpec, "concurrently" | "include" | "nullsNotDistinct" | "with">,
): number {
  return (
    (spec.concurrently === true ? 1 : 0) +
    (spec.include?.trim() ? 1 : 0) +
    (spec.nullsNotDistinct === true ? 1 : 0) +
    (spec.with?.trim() ? 1 : 0)
  );
}

/** Default body shown in the Create index sheet. */
export const DEFAULT_CREATE_INDEX_SQL = buildCreateIndexSql({
  name: "index_name",
  table: "table_name",
  columns: "column_name",
});

/**
 * True when the buffer is a CREATE INDEX statement (or UNIQUE).
 *
 * @param sql - Editor buffer
 */
export function isCreateIndexSql(sql: string): boolean {
  return /^\s*CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(sql);
}

/**
 * True when `clause` is a column list or WHERE predicate (no statement stacking).
 *
 * @param clause - Columns or WHERE body
 */
export function isSafeIndexClause(clause: string): boolean {
  const t = clause.trim();
  return t.length > 0 && t.length <= 2000 && !/;/.test(t) && !/--/.test(t) && !/\/\*/.test(t);
}

function formatIndexColumns(raw: string): string {
  if (!isSafeIndexClause(raw)) return quotePgIdent("column_name");
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return quotePgIdent("column_name");
  return parts.map((part) => (isPgIdent(part) ? quotePgIdent(part) : part)).join(", ");
}
