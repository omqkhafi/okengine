/**
 * In-memory runs driver — default for `test` environments.
 *
 * Uses DuckDB so queries match the `files` driver dialect (`FROM runs`).
 */

import type { DuckDBConnection } from "@duckdb/node-api";

import { duckLiteral, duckQuery, openDuckDB, type DuckSession } from "../duckdb.ts";
import { wideEventToRow, type ParquetRow } from "../parquet.ts";
import type { RunsDriver, RunsOpenOptions, RunsRow, RunsStore, WideEvent } from "../types.ts";

/**
 * Memory runs driver (DuckDB `:memory:`).
 */
export const memoryRunsDriver: RunsDriver = {
  id: "memory",
  async open(_options: RunsOpenOptions = {}): Promise<RunsStore> {
    const session: DuckSession = await openDuckDB();
    const events: WideEvent[] = [];

    return {
      driverId: "memory",
      async append(event: WideEvent): Promise<void> {
        events.push(event);
      },
      async flush(): Promise<void> {
        /* nothing buffered */
      },
      async query(sql: string): Promise<RunsRow[]> {
        await materialiseRunsTable(session.conn, events);
        return duckQuery(session.conn, sql);
      },
      async all(): Promise<WideEvent[]> {
        return [...events];
      },
      async close(): Promise<void> {
        events.length = 0;
        session.close();
      },
    };
  },
};

/**
 * Build / replace the `runs` table from wide events.
 *
 * @param conn - DuckDB connection
 * @param events - Events to materialise
 */
export async function materialiseRunsTable(
  conn: DuckDBConnection,
  events: readonly WideEvent[],
): Promise<void> {
  await conn.run(`DROP TABLE IF EXISTS runs`);
  if (events.length === 0) {
    await conn.run(`CREATE TABLE runs AS SELECT * FROM (SELECT 1 AS id WHERE FALSE)`);
    return;
  }
  // JSONL path avoids VALUES type-inference issues for mixed columns.
  const rows = events.map(wideEventToRow);
  const cols = unionKeys(rows);
  // For small test sets, VALUES is fine and keeps the driver dependency-light.
  const colList = cols.map((c) => `"${c.replaceAll('"', '""')}"`).join(", ");
  const values = rows
    .map((r) => `(${cols.map((c) => duckLiteral(r[c] ?? null)).join(", ")})`)
    .join(",\n");
  await conn.run(`CREATE TABLE runs AS SELECT * FROM (VALUES ${values}) AS t(${colList})`);
}

function unionKeys(rows: readonly ParquetRow[]): string[] {
  const keys = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) keys.add(k);
  }
  return [...keys];
}
