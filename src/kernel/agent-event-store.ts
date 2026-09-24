/**
 * Durable agent-run event log on the journal driver.
 *
 * Memory, file, and Postgres keep the same rows so a follower on another
 * instance, or after a restart, resumes from `Last-Event-ID`. The instance
 * that holds the run's journal lease is the only writer. A repeated seq is
 * an error.
 */

import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

/** Header stored beside the rows. */
export interface AgentEventHeaderRecord {
  readonly runId: string;
  readonly threadId: string;
  readonly tenant: string | null;
  readonly gates: readonly string[];
  readonly userId: string | null;
  readonly operatorId: string | null;
  /** Epoch ms the run was opened. Sweep uses this for abandoned runs. */
  readonly openedAt?: number;
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

/**
 * Thrown when a writer inserts a seq that is already stored.
 * The lease holder reads `MAX(seq)` before writing, so this is a bug.
 */
export class AgentEventDuplicateSeqError extends Error {
  /**
   * @param runId - Agent run
   * @param seq - Seq that was already stored
   */
  constructor(runId: string, seq: number) {
    super(`agent events: duplicate seq ${seq} for run "${runId}"`);
    this.name = "AgentEventDuplicateSeqError";
  }
}

/** Persistence for {@link AgentEventRecord}. */
export interface AgentEventStore {
  /** Load one run, or undefined when it was never opened. */
  read(runId: string): Promise<AgentEventRecord | undefined>;
  /** Rows with `seq` greater than `afterSeq`, in order. */
  readAfter(runId: string, afterSeq: number): Promise<readonly AgentEventRowRecord[]>;
  /** Highest stored seq, or 0 when the run has no rows. */
  maxSeq(runId: string): Promise<number>;
  /** Every header, including runs this process did not open. */
  listHeaders(): Promise<readonly AgentEventHeaderRecord[]>;
  /** Create or replace the header. Existing rows stay. */
  writeHeader(header: AgentEventHeaderRecord): Promise<void>;
  /**
   * Append one row. `seq` is already assigned.
   * A duplicate seq throws {@link AgentEventDuplicateSeqError}.
   */
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
    async readAfter(runId, afterSeq) {
      const run = runs.get(runId);
      if (!run) return [];
      return run.rows.filter((row) => row.seq > afterSeq).map((row) => ({ ...row }));
    },
    async maxSeq(runId) {
      const run = runs.get(runId);
      if (!run || run.rows.length === 0) return 0;
      return run.rows.reduce((max, row) => Math.max(max, row.seq), 0);
    },
    async listHeaders() {
      return [...runs.values()].map((run) => run.header);
    },
    async writeHeader(header) {
      const run = runs.get(header.runId);
      if (run) run.header = header;
      else runs.set(header.runId, { header, rows: [] });
    },
    async append(runId, row) {
      const run = runs.get(runId);
      if (!run) return;
      if (run.rows.some((stored) => stored.seq === row.seq)) {
        throw new AgentEventDuplicateSeqError(runId, row.seq);
      }
      run.rows.push(row);
    },
    async remove(runId) {
      runs.delete(runId);
    },
  };
}

interface JsonlLine {
  readonly kind: "header" | "row";
  readonly header?: AgentEventHeaderRecord;
  readonly seq?: number;
  readonly event?: unknown;
}

/**
 * Append-only event store. One JSONL file per run, guarded by a write lock.
 * Header updates append a new header line. Rows are never rewritten.
 *
 * @param dir - Directory of `{runId}.jsonl` files
 */
export function createFileAgentEventStore(dir: string): AgentEventStore {
  const locks = new Map<string, Promise<void>>();

  const withLock = async <T>(runId: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(runId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prev.then(() => gate);
    locks.set(runId, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  };

  const fileOf = (runId: string): string => join(dir, `${encodeURIComponent(runId)}.jsonl`);

  const readLines = async (runId: string): Promise<JsonlLine[]> => {
    const file = Bun.file(fileOf(runId));
    if (!(await file.exists())) return [];
    const text = await file.text();
    const lines: JsonlLine[] = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      lines.push(JSON.parse(line) as JsonlLine);
    }
    return lines;
  };

  const headerOf = (lines: readonly JsonlLine[]): AgentEventHeaderRecord | undefined => {
    let header: AgentEventHeaderRecord | undefined;
    for (const line of lines) {
      if (line.kind === "header" && line.header) header = line.header;
    }
    return header;
  };

  const rowsOf = (lines: readonly JsonlLine[]): AgentEventRowRecord[] => {
    const rows: AgentEventRowRecord[] = [];
    for (const line of lines) {
      if (line.kind === "row" && line.seq !== undefined) {
        rows.push({ seq: line.seq, event: line.event });
      }
    }
    return rows;
  };

  const appendLine = async (runId: string, line: JsonlLine): Promise<void> => {
    await mkdir(dir, { recursive: true });
    await appendFile(fileOf(runId), `${JSON.stringify(line)}\n`, "utf8");
  };

  return {
    async read(runId) {
      return withLock(runId, async () => {
        const lines = await readLines(runId);
        const header = headerOf(lines);
        if (!header) return undefined;
        return { header, rows: rowsOf(lines) };
      });
    },
    async readAfter(runId, afterSeq) {
      return withLock(runId, async () => {
        const rows = rowsOf(await readLines(runId));
        return rows.filter((row) => row.seq > afterSeq);
      });
    },
    async maxSeq(runId) {
      return withLock(runId, async () => {
        const rows = rowsOf(await readLines(runId));
        return rows.reduce((max, row) => Math.max(max, row.seq), 0);
      });
    },
    async listHeaders() {
      let names: string[] = [];
      try {
        names = await readdir(dir);
      } catch {
        return [];
      }
      const headers: AgentEventHeaderRecord[] = [];
      for (const name of names) {
        if (!name.endsWith(".jsonl")) continue;
        const runId = decodeURIComponent(name.slice(0, -".jsonl".length));
        const header = headerOf(await readLines(runId));
        if (header) headers.push(header);
      }
      return headers;
    },
    async writeHeader(header) {
      await withLock(header.runId, () => appendLine(header.runId, { kind: "header", header }));
    },
    async append(runId, row) {
      await withLock(runId, async () => {
        const rows = rowsOf(await readLines(runId));
        if (rows.some((stored) => stored.seq === row.seq)) {
          throw new AgentEventDuplicateSeqError(runId, row.seq);
        }
        await appendLine(runId, { kind: "row", seq: row.seq, event: row.event });
      });
    },
    async remove(runId) {
      await withLock(runId, async () => {
        await rm(fileOf(runId), { force: true });
      });
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
 * Followers read `seq > last`. A duplicate primary key is an error.
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

  const isDuplicate = (err: unknown): boolean => {
    const message = err instanceof Error ? err.message : String(err);
    return /duplicate key|unique constraint|PRIMARY KEY/i.test(message);
  };

  return {
    async read(runId) {
      const headers = await sql.query(`SELECT header FROM oke_agent_run WHERE run_id = ?`, [runId]);
      const headerRow = headers[0];
      if (!headerRow) return undefined;
      const header = JSON.parse(String(headerRow.header)) as AgentEventHeaderRecord;
      const rows = await readAfter(sql, runId, 0);
      return { header, rows };
    },
    async readAfter(runId, afterSeq) {
      return readAfter(sql, runId, afterSeq);
    },
    async maxSeq(runId) {
      const rows = await sql.query(
        `SELECT COALESCE(MAX(seq), 0) AS max_seq FROM oke_agent_event WHERE run_id = ?`,
        [runId],
      );
      return Number(rows[0]?.max_seq ?? 0);
    },
    async listHeaders() {
      const rows = await sql.query(`SELECT header FROM oke_agent_run`);
      return rows.map((row) => JSON.parse(String(row.header)) as AgentEventHeaderRecord);
    },
    async writeHeader(header) {
      await sql.exec(
        `INSERT INTO oke_agent_run (run_id, header) VALUES (?, ?)
         ON CONFLICT (run_id) DO UPDATE SET header = EXCLUDED.header`,
        [header.runId, JSON.stringify(header)],
      );
    },
    async append(runId, row) {
      try {
        await sql.exec(`INSERT INTO oke_agent_event (run_id, seq, event) VALUES (?, ?, ?)`, [
          runId,
          row.seq,
          JSON.stringify(row.event),
        ]);
      } catch (err) {
        if (isDuplicate(err)) throw new AgentEventDuplicateSeqError(runId, row.seq);
        throw err;
      }
    },
    async remove(runId) {
      await sql.exec(`DELETE FROM oke_agent_event WHERE run_id = ?`, [runId]);
      await sql.exec(`DELETE FROM oke_agent_run WHERE run_id = ?`, [runId]);
    },
  };
}

async function readAfter(
  sql: AgentEventSql,
  runId: string,
  afterSeq: number,
): Promise<AgentEventRowRecord[]> {
  const rows = await sql.query(
    `SELECT seq, event FROM oke_agent_event WHERE run_id = ? AND seq > ? ORDER BY seq`,
    [runId, afterSeq],
  );
  return rows.map((row) => ({
    seq: Number(row.seq),
    event: JSON.parse(String(row.event)),
  }));
}
