/**
 * Optional ClickHouse runs driver — sub-second over billions of rows at scale.
 *
 * Protocol-named (`clickhouse`). Opens with:
 * - injected `options.client` (tests / custom clients), or
 * - `options.url` → real ClickHouse HTTP interface (`JSONEachRow` insert,
 *   `FORMAT JSON` query) via `fetch` (no mandatory npm client), or
 * - neither → in-memory fake for unit tests.
 */

import type {
  RunsDriver,
  RunsOpenOptions,
  RunsRow,
  RunsStore,
  WideEvent,
} from "../types.ts";

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
  /**
   * Execute DDL / statements that return no rowset.
   *
   * @param sql - SQL text
   */
  exec?(sql: string): Promise<void>;
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
    async exec(_sql: string): Promise<void> {
      /* fake has no schema */
    },
  };
}

/**
 * ClickHouse HTTP client over `fetch` (native protocol surface — no vendor SDK).
 *
 * @param url - Base URL, e.g. `http://127.0.0.1:8123`
 * @param options - Optional auth + database
 */
export function createRunsClickHouseHttp(
  url: string,
  options: {
    readonly database?: string;
    readonly user?: string;
    readonly password?: string;
  } = {},
): RunsClickHouseClient {
  const base = url.replace(/\/$/, "");
  const database = options.database ?? "default";

  async function chFetch(sql: string, body?: string): Promise<Response> {
    const endpoint = new URL(base);
    endpoint.searchParams.set("database", database);
    endpoint.searchParams.set("query", sql);
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (options.user) {
      const token = btoa(`${options.user}:${options.password ?? ""}`);
      headers.authorization = `Basic ${token}`;
    }
    return fetch(endpoint, {
      method: "POST",
      headers,
      body,
    });
  }

  return {
    async insert(table: string, rows: readonly RunsRow[]): Promise<void> {
      if (rows.length === 0) return;
      const sql = `INSERT INTO ${table} FORMAT JSONEachRow`;
      const payload = rows.map((r) => JSON.stringify(r)).join("\n");
      const res = await chFetch(sql, payload);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `clickhouse insert failed: ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
        );
      }
    },
    async query(sql: string): Promise<RunsRow[]> {
      const withFormat = /format\s+\w+/i.test(sql)
        ? sql
        : `${sql}\nFORMAT JSON`;
      const res = await chFetch(withFormat);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `clickhouse query failed: ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
        );
      }
      const text = await res.text();
      if (!text.trim()) return [];
      const json = JSON.parse(text) as { data?: RunsRow[] };
      return json.data ?? [];
    },
    async exec(sql: string): Promise<void> {
      const res = await chFetch(sql);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `clickhouse exec failed: ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
        );
      }
    },
  };
}

/**
 * Ensure the runs table exists (idempotent).
 *
 * @param client - ClickHouse client
 * @param table - Table name
 */
export async function ensureClickHouseRunsTable(
  client: RunsClickHouseClient,
  table: string,
): Promise<void> {
  const ddl = `
    CREATE TABLE IF NOT EXISTS ${table} (
      id String,
      flow String,
      duration_ms Int64,
      payload String
    ) ENGINE = MergeTree
    ORDER BY (flow, id)
  `;
  if (client.exec) {
    await client.exec(ddl);
    return;
  }
  await client.query(ddl);
}

/**
 * ClickHouse runs driver.
 */
export const clickhouseRunsDriver: RunsDriver = {
  id: "clickhouse",
  async open(options: RunsOpenOptions = {}): Promise<RunsStore> {
    const table = options.name ?? "oke_runs";
    let client = options.client as RunsClickHouseClient | undefined;
    let ownsHttp = false;

    if (!client && options.url) {
      client = createRunsClickHouseHttp(options.url);
      ownsHttp = true;
      await ensureClickHouseRunsTable(client, table);
    }
    if (!client) {
      client = createRunsClickHouseFake();
    }

    const events: WideEvent[] = [];

    return {
      driverId: "clickhouse",
      async append(event: WideEvent): Promise<void> {
        events.push(event);
        await client!.insert(table, [
          {
            id: event.id,
            flow: event.flow,
            duration_ms: event.durationMs,
            payload: JSON.stringify(event),
          },
        ]);
      },
      async flush(): Promise<void> {
        /* inserts are immediate over HTTP / fake */
      },
      async query(sql: string): Promise<RunsRow[]> {
        return client!.query(sql);
      },
      async all(): Promise<WideEvent[]> {
        if ("events" in client!) {
          return [...(client as { events: WideEvent[] }).events];
        }
        return [...events];
      },
      async close(): Promise<void> {
        void ownsHttp;
        /* HTTP client is stateless fetch — nothing to close */
      },
    };
  },
};
