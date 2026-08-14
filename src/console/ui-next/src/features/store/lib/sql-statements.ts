/**
 * Statement bounds for the SQL query console (run current / selection).
 */

import { splitSqlPreservingStrings } from "./sql-format.ts";

/** One executable statement in a buffer. */
export type SqlStatement = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** 1-based line of the first non-whitespace character. */
  readonly startLine: number;
};

/**
 * Split SQL on `;` outside quotes. Trailing text without a semicolon is kept.
 *
 * @param sql - Editor buffer
 */
export function splitSqlStatements(sql: string): readonly SqlStatement[] {
  const parts = splitSqlPreservingStrings(sql);
  const out: SqlStatement[] = [];
  let stmtStart = 0;
  let offset = 0;
  for (const part of parts) {
    if (!part.quoted) {
      for (let i = 0; i < part.text.length; i += 1) {
        if (part.text[i] !== ";") continue;
        const end = offset + i + 1;
        pushStatement(out, sql, stmtStart, end);
        stmtStart = end;
      }
    }
    offset += part.text.length;
  }
  pushStatement(out, sql, stmtStart, sql.length);
  return out;
}

/**
 * Statement that contains `cursor` (or the last one before it).
 *
 * @param sql - Editor buffer
 * @param cursor - Caret offset
 */
export function statementAtCursor(sql: string, cursor: number): SqlStatement | null {
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) return null;
  const clamped = Math.max(0, Math.min(cursor, sql.length));
  for (const stmt of statements) {
    if (clamped >= stmt.start && clamped <= stmt.end) return stmt;
  }
  return statements[statements.length - 1] ?? null;
}

/**
 * Text to execute: the selection when non-empty, otherwise the statement at the caret.
 *
 * @param sql - Editor buffer
 * @param selectionStart - Selection anchor
 * @param selectionEnd - Selection focus
 */
export function sqlToRun(sql: string, selectionStart: number, selectionEnd: number): string {
  const from = Math.min(selectionStart, selectionEnd);
  const to = Math.max(selectionStart, selectionEnd);
  if (to > from) {
    const selected = sql.slice(from, to).trim();
    if (selected.length > 0) return selected;
  }
  return statementAtCursor(sql, from)?.text ?? sql.trim();
}

/**
 * Statements to execute for current / selection / whole script.
 *
 * @param sql - Editor buffer
 * @param selectionStart - Selection anchor
 * @param selectionEnd - Selection focus
 * @param mode - Current statement, selection, or all
 */
export function sqlBatchToRun(
  sql: string,
  selectionStart: number,
  selectionEnd: number,
  mode: "current" | "all",
): readonly string[] {
  if (mode === "all") {
    return splitSqlStatements(sql).map((stmt) => stmt.text);
  }
  const from = Math.min(selectionStart, selectionEnd);
  const to = Math.max(selectionStart, selectionEnd);
  if (to > from) {
    const selected = sql.slice(from, to);
    const parts = splitSqlStatements(selected).map((stmt) => stmt.text);
    if (parts.length > 0) return parts;
  }
  const one = statementAtCursor(sql, from)?.text ?? sql.trim();
  return one.length > 0 ? [one] : [];
}

/**
 * Prefix a statement with `EXPLAIN` or `EXPLAIN ANALYZE`.
 *
 * @param sql - One statement
 * @param analyze - When true, `EXPLAIN ANALYZE`
 */
export function wrapExplain(sql: string, analyze: boolean): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (trimmed.length === 0) return trimmed;
  if (/^EXPLAIN\b/i.test(trimmed)) return trimmed;
  return analyze ? `EXPLAIN ANALYZE ${trimmed}` : `EXPLAIN ${trimmed}`;
}

/**
 * True when the statement mutates the store (DML / DDL).
 * Keep heads in sync with `runStoreSql` in `src/console/server/store.ts`.
 *
 * @param sql - One statement
 */
const WRITE_HEADS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "REPLACE",
  "GRANT",
  "REVOKE",
  "VACUUM",
  "COMMENT",
  "COPY",
  "CALL",
  "REFRESH",
  "MERGE",
]);

export function isSqlWrite(sql: string): boolean {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  const head = leadingKeyword(trimmed);
  if (head === "EXPLAIN") return /\bANALYZE\b/i.test(trimmed);
  if (head === "ANALYZE") return true;
  return WRITE_HEADS.has(head);
}

/**
 * True when the statement is a SELECT (or WITH) that has no LIMIT.
 *
 * @param sql - One statement
 */
export function isUnboundedSelect(sql: string): boolean {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (trimmed.length === 0) return false;
  const head = leadingKeyword(trimmed);
  if (head !== "SELECT" && head !== "WITH") return false;
  for (const part of splitSqlPreservingStrings(trimmed)) {
    if (part.quoted) continue;
    if (/\bLIMIT\b/i.test(part.text)) return false;
  }
  return true;
}

/**
 * 1-based line number for an offset.
 *
 * @param text - Source
 * @param offset - Character offset
 */
export function lineAtOffset(text: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  for (let i = 0; i < clamped; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function pushStatement(out: SqlStatement[], sql: string, start: number, end: number): void {
  const raw = sql.slice(start, end);
  if (raw.replace(/[;\s]/g, "").length === 0) return;
  const first = start + (raw.match(/^\s*/)?.[0]?.length ?? 0);
  out.push({
    text: raw.trim(),
    start,
    end,
    startLine: lineAtOffset(sql, first),
  });
}

/**
 * First keyword of a statement (`SELECT`, `CREATE`, …).
 *
 * @param sql - One statement
 */
export function sqlStatementLabel(sql: string): string {
  const head = leadingKeyword(sql.trim().replace(/;+\s*$/, ""));
  return head.length > 0 ? head : "SQL";
}

function leadingKeyword(sql: string): string {
  const match = /^([A-Za-z]+)/.exec(sql);
  return match?.[1]?.toUpperCase() ?? "";
}
