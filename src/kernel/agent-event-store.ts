/**
 * Durable agent-run event log on the journal driver.
 *
 * Memory, file, and Postgres keep the same rows so a follower on another
 * instance, or after a restart, resumes from `Last-Event-ID`.
 */

/** Header stored beside the rows. */
export interface AgentEventHeaderRecord {
  readonly runId: string;
  readonly threadId: string;
  readonly tenant: string | null;
  readonly gates: readonly string[];
  readonly userId: string | null;
  readonly operatorId: string | null;
  readonly finishedAt?: number;
}

/** One stored SSE row. */
export interface AgentEventRowRecord {
  readonly seq: number;
  readonly event: unknown;
}

/** One run's durable log. */
export interface AgentEventRecord {
  readonly header: AgentEventHeaderRecord;
  readonly rows: readonly AgentEventRowRecord[];
}

/** Persistence for {@link AgentEventRecord}. */
export interface AgentEventStore {
  /** Load one run, or undefined when it was never opened. */
  read(runId: string): Promise<AgentEventRecord | undefined>;
  /** Create or replace the header. Existing rows stay. */
  writeHeader(header: AgentEventHeaderRecord): Promise<void>;
  /** Append one row. `seq` is already assigned and monotonic per run. */
  append(runId: string, row: AgentEventRowRecord): Promise<void>;
  /** Drop a finished run. */
  remove(runId: string): Promise<void>;
}

/** In-memory event store. */
export function createMemoryAgentEventStore(): AgentEventStore {
  const runs = new Map<string, { header: AgentEventHeaderRecord; rows: AgentEventRowRecord[] }>();
  return {
    async read(runId) {
      const run = runs.get(runId);
      if (!run) return undefined;
      return { header: run.header, rows: run.rows.map((row) => ({ ...row })) };
    },
    async writeHeader(header) {
      const run = runs.get(header.runId);
      if (run) run.header = header;
      else runs.set(header.runId, { header, rows: [] });
    },
    async append(runId, row) {
      const run = runs.get(runId);
      if (!run) return;
      run.rows.push(row);
    },
    async remove(runId) {
      runs.delete(runId);
    },
  };
}

/** File-backed event store. Survives process restart. */
export function createFileAgentEventStore(path: string): AgentEventStore {
  let cache: Map<string, { header: AgentEventHeaderRecord; rows: AgentEventRowRecord[] }> | undefined;

  const load = async (): Promise<
    Map<string, { header: AgentEventHeaderRecord; rows: AgentEventRowRecord[] }>
  > => {
    if (cache) return cache;
    cache = new Map();
    const file = Bun.file(path);
    if (!(await file.exists())) return cache;
    const raw = (await file.json()) as { runs?: AgentEventRecord[] };
    for (const run of raw.runs ?? []) {
      cache.set(run.header.runId, { header: run.header, rows: [...run.rows] });
    }
    return cache;
  };

  const flush = async (): Promise<void> => {
    const map = await load();
    const runs = [...map.values()].map((run) => ({ header: run.header, rows: run.rows }));
    await Bun.write(path, JSON.stringify({ runs }));
  };

  return {
    async read(runId) {
      const run = (await load()).get(runId);
      if (!run) return undefined;
      return { header: run.header, rows: run.rows.map((row) => ({ ...row })) };
    },
    async writeHeader(header) {
      const map = await load();
      const run = map.get(header.runId);
      if (run) run.header = header;
      else map.set(header.runId, { header, rows: [] });
      await flush();
    },
    async append(runId, row) {
      const run = (await load()).get(runId);
      if (!run) return;
      run.rows.push(row);
      await flush();
    },
    async remove(runId) {
      (await load()).delete(runId);
      await flush();
    },
  };
}

/** SQL client the postgres event store needs. */
export interface AgentEventSql {
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  exec(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
}

/**
 * Postgres event store on the journal connection.
 *
 * @param sql - Journal SQL client
 */
export async function createPostgresAgentEventStore(sql: AgentEventSql): Promise<AgentEventStore> {
  await sql.exec(`CREATE TABLE IF NOT EXISTS oke_agent_run (
    run_id TEXT PRIMARY KEY,
    header TEXT NOT NULL
  )`);
  await sql.exec(`CREATE TABLE IF NOT EXISTS oke_agent_event (
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
  )`);

  return {
    async read(runId) {
      const headers = await sql.query(`SELECT header FROM oke_agent_run WHERE run_id = ?`, [runId]);
      const headerRow = headers[0];
      if (!headerRow) return undefined;
      const header = JSON.parse(String(headerRow.header)) as AgentEventHeaderRecord;
      const rows = await sql.query(
        `SELECT seq, event FROM oke_agent_event WHERE run_id = ? ORDER BY seq`,
        [runId],
      );
      return {
        header,
        rows: rows.map((row) => ({
          seq: Number(row.seq),
          event: JSON.parse(String(row.event)),
        })),
      };
    },
    async writeHeader(header) {
      await sql.exec(
        `INSERT INTO oke_agent_run (run_id, header) VALUES (?, ?)
         ON CONFLICT (run_id) DO UPDATE SET header = EXCLUDED.header`,
        [header.runId, JSON.stringify(header)],
      );
    },
    async append(runId, row) {
      await sql.exec(
        `INSERT INTO oke_agent_event (run_id, seq, event) VALUES (?, ?, ?)
         ON CONFLICT (run_id, seq) DO NOTHING`,
        [runId, row.seq, JSON.stringify(row.event)],
      );
    },
    async remove(runId) {
      await sql.exec(`DELETE FROM oke_agent_event WHERE run_id = ?`, [runId]);
      await sql.exec(`DELETE FROM oke_agent_run WHERE run_id = ?`, [runId]);
    },
  };
}
