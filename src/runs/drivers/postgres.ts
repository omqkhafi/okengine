/**
 * Optional Postgres runs driver — for teams who want a single store.
 *
 * Protocol-named. Uses an injected client in tests; production binds Bun.sql.
 */

import type { RunsDriver, RunsOpenOptions, RunsRow, RunsStore, WideEvent } from "../types.ts";

/** Minimal SQL surface used by the postgres runs driver. */
export interface RunsPostgresClient {
  /**
   * Run a query returning rows.
   *
   * @param sql - SQL text
   * @param params - Bound parameters
   */
  query(sql: string, params?: readonly unknown[]): Promise<RunsRow[]>;
  /**
   * Execute a statement.
   *
   * @param sql - SQL text
   * @param params - Bound parameters
   */
  exec(sql: string, params?: readonly unknown[]): Promise<void>;
}

/**
 * In-memory fake Postgres client for tests.
 */
export function createRunsPostgresFake(): RunsPostgresClient & {
  readonly events: WideEvent[];
} {
  const events: WideEvent[] = [];
  return {
    events,
    async query(sql: string): Promise<RunsRow[]> {
      const lower = sql.toLowerCase();
      if (lower.includes("count(*)")) {
        return [{ count: events.length }];
      }
      if (lower.includes("select payload")) {
        return events.map((e) => ({ payload: e }));
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
    async exec(sql: string, params?: readonly unknown[]): Promise<void> {
      const lower = sql.toLowerCase();
      if (lower.includes("insert") && params && params.length >= 2) {
        events.push(JSON.parse(String(params[1])) as WideEvent);
      }
    },
  };
}

/**
 * Postgres runs driver.
 */
export const postgresRunsDriver: RunsDriver = {
  id: "postgres",
  async open(options: RunsOpenOptions = {}): Promise<RunsStore> {
    const client = (options.client as RunsPostgresClient | undefined) ?? createRunsPostgresFake();
    const table = options.name ?? "oke_runs";
    await client.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, payload JSONB)`);

    return {
      driverId: "postgres",
      async append(event: WideEvent): Promise<void> {
        await client.exec(`INSERT INTO ${table} (id, payload) VALUES ($1, $2::jsonb)`, [
          event.id,
          JSON.stringify(event),
        ]);
      },
      async flush(): Promise<void> {
        /* row-level writes are immediate */
      },
      async query(
        sql: string,
        _options?: import("../types.ts").RunsQueryOptions,
      ): Promise<RunsRow[]> {
        return client.query(sql);
      },
      async all(): Promise<WideEvent[]> {
        const result = await client.query(`SELECT payload FROM ${table}`);
        return result.map((r) => {
          const p = r.payload ?? r;
          return typeof p === "string" ? (JSON.parse(p) as WideEvent) : (p as WideEvent);
        });
      },
      async close(): Promise<void> {
        /* fake has no resources */
      },
    };
  },
};
