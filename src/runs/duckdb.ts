/**
 * Thin DuckDB adapter — adopted via `@duckdb/node-api`, not reinvented.
 */

import type { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

import { importOptionalPeer } from "../shared/optional-peer.ts";
import type { RunsRow } from "./types.ts";

/** DuckDB session — instance kept alive with the connection. */
export interface DuckSession {
  /** DuckDB instance (must outlive the connection). */
  readonly instance: DuckDBInstance;
  /** Active connection. */
  readonly conn: DuckDBConnection;
  /** Close connection + instance. */
  close(): void;
}

/** Open an in-memory DuckDB session. */
export async function openDuckDB(): Promise<DuckSession> {
  const mod = await importOptionalPeer<typeof import("@duckdb/node-api")>(
    "@duckdb/node-api",
    "Runs DuckDB / Parquet queries",
  );
  const instance = await mod.DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  return {
    instance,
    conn,
    close() {
      try {
        (conn as { closeSync?: () => void }).closeSync?.();
      } catch {
        /* ignore */
      }
      try {
        (instance as { closeSync?: () => void }).closeSync?.();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Run a query and return plain JSON-friendly row objects.
 *
 * @param conn - DuckDB connection
 * @param sql - SQL text
 */
export async function duckQuery(conn: DuckDBConnection, sql: string): Promise<RunsRow[]> {
  const reader = await conn.runAndReadAll(sql);
  const rows = reader.getRowObjectsJson() as RunsRow[];
  return rows.map(normalizeRow);
}

/** Thrown when {@link duckQueryWithTimeout} exceeds `timeoutMs`. */
export class DuckQueryTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`runs query timed out after ${timeoutMs}ms`);
    this.name = "DuckQueryTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Run {@link duckQuery} with a wall-clock timeout and optional interrupt.
 *
 * @param conn - DuckDB connection
 * @param sql - SQL text
 * @param timeoutMs - Deadline
 */
export async function duckQueryWithTimeout(
  conn: DuckDBConnection,
  sql: string,
  timeoutMs: number,
): Promise<RunsRow[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        (conn as { interrupt?: () => void }).interrupt?.();
      } catch {
        /* ignore */
      }
      reject(new DuckQueryTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([duckQuery(conn, sql), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Escape a filesystem path for use inside a DuckDB string literal.
 *
 * @param path - Absolute path
 */
export function duckPath(path: string): string {
  return path.replaceAll("'", "''");
}

/**
 * Quote an identifier.
 *
 * @param id - Column / table name
 */
export function duckIdent(id: string): string {
  return `"${id.replaceAll('"', '""')}"`;
}

/**
 * SQL literal for a JS value.
 *
 * @param value - Value to embed
 */
export function duckLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "bigint") return `${value}`;
  const s = String(value).replaceAll("'", "''");
  return `'${s}'`;
}

function normalizeRow(row: RunsRow): RunsRow {
  const out: RunsRow = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === "bigint" ? Number(v) : v;
  }
  return out;
}
