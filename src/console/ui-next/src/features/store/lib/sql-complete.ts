/**
 * Schema-aware completions for the Store query console.
 */

import { splitSqlPreservingStrings } from "./sql-format.ts";
import { statementAtCursor } from "./sql-statements.ts";
import type { QuerySchemaTable } from "./query-schema.ts";

/** What a completion inserts. */
export type SqlCompleteKind = "keyword" | "table" | "column" | "command" | "namespace";

/** One completion row. */
export type SqlCompletion = {
  readonly kind: SqlCompleteKind;
  readonly label: string;
  readonly insert: string;
  readonly detail?: string;
  readonly pii?: boolean;
  readonly primaryKey?: boolean;
  readonly foreignKey?: boolean;
};

/** Replace range + ranked items. */
export type SqlCompleteResult = {
  readonly from: number;
  readonly to: number;
  readonly items: readonly SqlCompletion[];
};

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT JOIN",
  "INNER JOIN",
  "RIGHT JOIN",
  "FULL JOIN",
  "ON",
  "AND",
  "OR",
  "ORDER BY",
  "GROUP BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "UNION",
  "INSERT INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE FROM",
  "CREATE TABLE",
  "CREATE INDEX",
  "ALTER TABLE",
  "DROP TABLE",
  "TRUNCATE",
  "EXPLAIN",
  "EXPLAIN ANALYZE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "GRANT",
  "AS",
  "DISTINCT",
  "COUNT",
  "LIKE",
  "ILIKE",
  "IN",
  "IS NULL",
  "IS NOT NULL",
  "NOT",
  "ASC",
  "DESC",
  "WITH",
  "RETURNING",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
] as const;

const TABLE_CONTEXT = new Set(["FROM", "JOIN", "INTO", "UPDATE", "TABLE"]);
const COLUMN_CONTEXT = new Set([
  "SELECT",
  "WHERE",
  "SET",
  "ON",
  "BY",
  "HAVING",
  "AND",
  "OR",
  "RETURNING",
]);

const IDENT = /[A-Za-z0-9_]/;

/**
 * Completions at `cursor` from Manifest tables / KV namespaces.
 *
 * @param text - Editor buffer
 * @param cursor - Caret offset
 * @param tables - Schema catalog
 * @param facet - SQL or KV
 */
export function completeQuery(
  text: string,
  cursor: number,
  tables: readonly QuerySchemaTable[],
  facet: "sql" | "kv" = "sql",
): SqlCompleteResult | null {
  const clamped = Math.max(0, Math.min(cursor, text.length));
  if (facet === "kv") return completeKv(text, clamped, tables);
  if (inSingleQuotedString(text, clamped)) return null;
  return completeSql(text, clamped, tables);
}

function completeSql(
  text: string,
  cursor: number,
  tables: readonly QuerySchemaTable[],
): SqlCompleteResult | null {
  const token = tokenBefore(text, cursor);
  const prefix = token.prefix.toLowerCase();
  const qualifier = token.qualifier;
  const keyword = lastKeyword(text, token.from);
  const stmt = statementAtCursor(text, cursor);
  const referenced = stmt ? referencedTables(stmt.text, tables) : [];

  const items: SqlCompletion[] = [];

  if (qualifier !== null) {
    const table = findTable(tables, qualifier);
    if (!table) return null;
    for (const col of table.columns) {
      if (!matchesPrefix(col.name, prefix)) continue;
      items.push(columnItem(col, table.name));
    }
    return finish(token.from, cursor, items);
  }

  const wantTables = keyword !== null && TABLE_CONTEXT.has(keyword);
  const wantColumns = keyword !== null && COLUMN_CONTEXT.has(keyword);

  if (wantTables || (!wantColumns && prefix.length > 0)) {
    for (const table of tables) {
      if (!matchesPrefix(table.name, prefix)) continue;
      items.push({
        kind: "table",
        label: table.name,
        insert: quoteIdent(table.name),
        detail: "table",
      });
    }
  }

  if (wantColumns || (!wantTables && prefix.length > 0)) {
    const preferred = referenced.length > 0 ? referenced : tables.map((t) => t.name);
    const seen = new Set<string>();
    for (const name of preferred) {
      const table = findTable(tables, name);
      if (!table) continue;
      for (const col of table.columns) {
        const key = `${table.name}.${col.name}`;
        if (seen.has(key) || !matchesPrefix(col.name, prefix)) continue;
        seen.add(key);
        items.push(columnItem(col, table.name));
      }
    }
    if (referenced.length > 0 && prefix.length > 0) {
      for (const table of tables) {
        if (preferred.includes(table.name)) continue;
        for (const col of table.columns) {
          const key = `${table.name}.${col.name}`;
          if (seen.has(key) || !matchesPrefix(col.name, prefix)) continue;
          seen.add(key);
          items.push(columnItem(col, table.name));
        }
      }
    }
  }

  if (prefix.length > 0) {
    for (const word of SQL_KEYWORDS) {
      if (!matchesPrefix(word, prefix)) continue;
      items.push({ kind: "keyword", label: word, insert: word, detail: "keyword" });
    }
  }

  return finish(token.from, cursor, items);
}

function completeKv(
  text: string,
  cursor: number,
  tables: readonly QuerySchemaTable[],
): SqlCompleteResult | null {
  const lineStart = text.lastIndexOf("\n", cursor - 1) + 1;
  const line = text.slice(lineStart, cursor);
  if (/^\s*(\/\/|#|--)/.test(line)) return null;

  const token = tokenBefore(text, cursor);
  const prefix = token.prefix.toLowerCase();
  const before = text.slice(lineStart, token.from).trim().toLowerCase();
  const items: SqlCompletion[] = [];

  if (
    before === "list" ||
    before === "get" ||
    before === "set" ||
    before === "delete" ||
    before === "ttl" ||
    before === "set(" ||
    before === "get(" ||
    before === "list(" ||
    before === "delete(" ||
    before === "ttl("
  ) {
    for (const table of tables) {
      if (!matchesPrefix(table.name, prefix)) continue;
      items.push({
        kind: "namespace",
        label: table.name,
        insert: `${table.name}:`,
        detail: "namespace",
      });
    }
    return finish(token.from, cursor, items);
  }

  if (before.length === 0) {
    for (const command of ["list", "get", "set", "delete", "ttl"] as const) {
      if (!matchesPrefix(command, prefix)) continue;
      items.push({
        kind: "command",
        label: command,
        insert: command === "set" ? "set(" : `${command} `,
        detail: "command",
      });
    }
    for (const table of tables) {
      if (!matchesPrefix(table.name, prefix)) continue;
      items.push({
        kind: "namespace",
        label: table.name,
        insert: table.name,
        detail: "namespace",
      });
    }
  }

  return finish(token.from, cursor, items);
}

function finish(from: number, to: number, items: SqlCompletion[]): SqlCompleteResult | null {
  if (items.length === 0) return null;
  items.sort((a, b) => {
    const kind = kindRank(a.kind) - kindRank(b.kind);
    if (kind !== 0) return kind;
    return a.label.localeCompare(b.label);
  });
  return { from, to, items: items.slice(0, 12) };
}

function kindRank(kind: SqlCompleteKind): number {
  if (kind === "table" || kind === "namespace") return 0;
  if (kind === "column" || kind === "command") return 1;
  return 2;
}

function columnItem(col: QuerySchemaTable["columns"][number], table: string): SqlCompletion {
  return {
    kind: "column",
    label: col.name,
    insert: quoteIdent(col.name),
    detail: col.type === "unknown" ? table : `${table} · ${col.type}`,
    ...(col.pii === true ? { pii: true } : {}),
    ...(col.primaryKey === true ? { primaryKey: true } : {}),
    ...(col.references ? { foreignKey: true } : {}),
  };
}

function tokenBefore(
  text: string,
  cursor: number,
): { readonly from: number; readonly prefix: string; readonly qualifier: string | null } {
  let i = cursor;
  while (i > 0) {
    const ch = text[i - 1];
    if (ch && (IDENT.test(ch) || ch === '"')) {
      i -= 1;
      continue;
    }
    break;
  }
  let raw = text.slice(i, cursor);
  let qualifier: string | null = null;
  if (i > 0 && text[i - 1] === ".") {
    let qEnd = i - 1;
    let qStart = qEnd;
    while (qStart > 0) {
      const ch = text[qStart - 1];
      if (ch && (IDENT.test(ch) || ch === '"')) {
        qStart -= 1;
        continue;
      }
      break;
    }
    qualifier = unquote(text.slice(qStart, qEnd));
    // Replace only the column token, not `table.`
  }
  if (raw.startsWith('"')) raw = raw.slice(1);
  if (raw.endsWith('"')) raw = raw.slice(0, -1);
  return { from: i, prefix: raw, qualifier };
}

function lastKeyword(text: string, before: number): string | null {
  const head = text.slice(0, before);
  let last: string | null = null;
  for (const part of splitSqlPreservingStrings(head)) {
    if (part.quoted) continue;
    const words = part.text.toUpperCase().match(/[A-Z]+/g);
    if (!words) continue;
    last = words[words.length - 1] ?? last;
  }
  return last;
}

function referencedTables(sql: string, tables: readonly QuerySchemaTable[]): readonly string[] {
  const names = new Set(tables.map((t) => t.name.toLowerCase()));
  const found: string[] = [];
  for (const part of splitSqlPreservingStrings(sql)) {
    if (!part.quoted) continue;
    const name = unquote(part.text);
    if (names.has(name.toLowerCase()) && !found.includes(name)) found.push(name);
  }
  const unquoted = /\b(?:FROM|JOIN|INTO|UPDATE)\s+("?[A-Za-z_][A-Za-z0-9_]*"?)/gi;
  let match: RegExpExecArray | null;
  while ((match = unquoted.exec(sql))) {
    const name = unquote(match[1] ?? "");
    if (names.has(name.toLowerCase()) && !found.includes(name)) found.push(name);
  }
  return found;
}

function findTable(
  tables: readonly QuerySchemaTable[],
  name: string,
): QuerySchemaTable | undefined {
  const lower = name.toLowerCase();
  return tables.find((t) => t.name.toLowerCase() === lower);
}

function matchesPrefix(value: string, prefix: string): boolean {
  if (prefix.length === 0) return true;
  return value.toLowerCase().startsWith(prefix);
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function unquote(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function inSingleQuotedString(sql: string, cursor: number): boolean {
  let offset = 0;
  for (const part of splitSqlPreservingStrings(sql)) {
    const next = offset + part.text.length;
    if (cursor > offset && cursor <= next && part.quoted && part.text.startsWith("'")) {
      return true;
    }
    offset = next;
  }
  return false;
}
