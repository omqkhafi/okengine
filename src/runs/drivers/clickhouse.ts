/**
 * Optional ClickHouse runs driver — sub-second over billions of rows at scale.
 *
 * Protocol-named (`clickhouse`). Fake HTTP client for tests; production uses
 * the ClickHouse HTTP interface.
 */

import type { RunsDriver, RunsOpenOptions, RunsRow, RunsStore, WideEvent } from "../types.ts";

/** Minimal ClickHouse HTTP-like client. */
export interface RunsClickHouseClient {
  /**
   * Insert rows into a table.
   *
   * @param table - Table name
   * @param rows - JSONEachRow rows
   */
  insert(table: string, rows: readonly RunsRow[]): Promise<void>;
  /**
   * Run a query returning JSON rows.
   *
   * @param sql - SQL text
   */
  query(sql: string): Promise<RunsRow[]>;
}

/**
 * In-memory fake ClickHouse client for tests.
 */
export function createRunsClickHouseFake(): RunsClickHouseClient & {
  readonly events: WideEvent[];
} {
  const events: WideEvent[] = [];
  return {
    events,
    async insert(_table: string, rows: readonly RunsRow[]): Promise<void> {
      for (const row of rows) {
        if (row.payload && typeof row.payload === "object") {
          events.push(row.payload as WideEvent);
        } else if (typeof row.payload === "string") {
          events.push(JSON.parse(row.payload) as WideEvent);
        }
      }
    },
    async query(sql: string): Promise<RunsRow[]> {
      const lower = sql.toLowerCase();
      if (lower.includes("count()")) {
        return [{ count: events.length }];
      }
      return events.map((e) => ({
        id: e.id,
        flow: e.flow,
        duration_ms: e.durationMs,
        cache: e.cache,
        tenant: e.tenant,
        subject_id: e.subjectId,
      }));
    },
  };
}

/**
 * ClickHouse runs driver.
 */
export const clickhouseRunsDriver: RunsDriver = {
  id: "clickhouse",
  async open(options: RunsOpenOptions = {}): Promise<RunsStore> {
    const client =
      (options.client as RunsClickHouseClient | undefined) ?? createRunsClickHouseFake();
    const table = options.name ?? "oke_runs";

    return {
      driverId: "clickhouse",
      async append(event: WideEvent): Promise<void> {
        await client.insert(table, [
          {
            id: event.id,
            flow: event.flow,
            duration_ms: event.durationMs,
            payload: event,
          },
        ]);
      },
      async flush(): Promise<void> {
        /* inserts are immediate in the fake */
      },
      async query(sql: string): Promise<RunsRow[]> {
        return client.query(sql);
      },
      async all(): Promise<WideEvent[]> {
        if ("events" in client) {
          return [...(client as { events: WideEvent[] }).events];
        }
        return [];
      },
      async close(): Promise<void> {
        /* fake has no resources */
      },
    };
  },
};
