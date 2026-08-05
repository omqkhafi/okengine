/**
 * Parquet partition writer — DuckDB `COPY … (FORMAT PARQUET)`.
 *
 * Locality (local vs object storage) is decided by the files driver; this
 * module only serialises wide events into columnar files.
 */

import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { duckPath, duckQuery, openDuckDB } from "./duckdb.ts";
import type { WideEvent } from "./types.ts";

/** Flattened Parquet / SQL row. */
export type ParquetRow = Record<string, string | number | boolean | null>;

/**
 * Flatten a wide event into a columnar row.
 *
 * Structured fields become JSON strings; scalar dimensions are promoted to
 * top-level columns for outlier / filter queries.
 *
 * @param event - Wide event
 */
export function wideEventToRow(event: WideEvent): ParquetRow {
  const row: ParquetRow = {
    id: event.id,
    parent_id: event.parentId ?? null,
    flow: event.flow,
    unit: event.unit ?? null,
    trigger: event.trigger,
    plane: event.plane,
    tenant: event.tenant ?? null,
    principal: event.principal ?? null,
    subject_id: event.subjectId ?? null,
    gates: JSON.stringify(event.gates),
    cache: event.cache,
    replica: event.replica ?? null,
    replica_lag_ms: event.replicaLagMs ?? null,
    cost: event.cost ?? null,
    prompt_version: event.promptVersion ?? null,
    build_version: event.buildVersion ?? null,
    error_code: event.error?.code ?? null,
    error_message: event.error?.message ?? null,
    input: event.input === undefined ? null : JSON.stringify(event.input),
    effects: JSON.stringify(event.effects),
    logs: JSON.stringify(event.logs),
    duration_ms: event.durationMs,
    started_at: event.startedAt,
    ended_at: event.endedAt,
    archived: JSON.stringify(event.archived ?? {}),
    dimensions: JSON.stringify(event.dimensions),
  };
  for (const [k, v] of Object.entries(event.dimensions)) {
    const col = `dim_${k}`;
    if (row[col] !== undefined) continue;
    if (v === undefined) continue;
    row[col] =
      typeof v === "string" || typeof v === "number" || typeof v === "boolean"
        ? v
        : v === null
          ? null
          : String(v);
  }
  return row;
}

/**
 * Reconstruct a {@link WideEvent} from a Parquet / SQL row.
 *
 * @param row - Flat row
 */
export function rowToWideEvent(row: Record<string, unknown>): WideEvent {
  const dimensions =
    typeof row.dimensions === "string"
      ? (JSON.parse(row.dimensions) as WideEvent["dimensions"])
      : ((row.dimensions as WideEvent["dimensions"]) ?? {});
  const archivedRaw =
    typeof row.archived === "string"
      ? (JSON.parse(row.archived) as Record<string, string>)
      : ((row.archived as Record<string, string>) ?? {});
  const errorCode = row.error_code;
  return {
    id: String(row.id),
    ...(row.parent_id != null ? { parentId: String(row.parent_id) } : {}),
    flow: String(row.flow),
    ...(row.unit != null ? { unit: String(row.unit) } : {}),
    trigger: String(row.trigger),
    plane: (row.plane as WideEvent["plane"]) ?? "user",
    tenant: row.tenant != null ? String(row.tenant) : null,
    principal: row.principal != null ? String(row.principal) : null,
    subjectId: row.subject_id != null ? String(row.subject_id) : null,
    gates: parseJsonArray(row.gates) as string[],
    cache: (row.cache as WideEvent["cache"]) ?? "none",
    ...(row.replica != null ? { replica: row.replica as "primary" | "replica" } : {}),
    ...(row.replica_lag_ms != null ? { replicaLagMs: Number(row.replica_lag_ms) } : {}),
    ...(row.cost != null ? { cost: Number(row.cost) } : {}),
    ...(row.prompt_version != null ? { promptVersion: Number(row.prompt_version) } : {}),
    ...(row.build_version != null ? { buildVersion: String(row.build_version) } : {}),
    error:
      errorCode != null
        ? {
            code: String(errorCode),
            ...(row.error_message != null ? { message: String(row.error_message) } : {}),
          }
        : null,
    ...(row.input != null && row.input !== ""
      ? {
          input:
            typeof row.input === "string"
              ? (JSON.parse(row.input) as unknown)
              : (row.input as unknown),
        }
      : {}),
    effects: parseJsonArray(row.effects) as WideEvent["effects"],
    logs: parseJsonArray(row.logs) as WideEvent["logs"],
    durationMs: Number(row.duration_ms ?? 0),
    startedAt: Number(row.started_at ?? 0),
    endedAt: Number(row.ended_at ?? 0),
    ...(Object.keys(archivedRaw).length > 0 ? { archived: archivedRaw } : {}),
    dimensions,
  };
}

/**
 * Write rows to a Parquet file via DuckDB (JSONL → COPY).
 *
 * @param path - Absolute output path
 * @param rows - Flattened rows
 */
export async function writeParquet(path: string, rows: readonly ParquetRow[]): Promise<void> {
  if (rows.length === 0) return;
  await mkdir(dirname(path), { recursive: true });
  const jsonl = `${path}.jsonl`;
  await writeFile(jsonl, rows.map((r) => JSON.stringify(r)).join("\n"));
  const session = await openDuckDB();
  try {
    await session.conn.run(
      `COPY (SELECT * FROM read_json_auto('${duckPath(jsonl)}')) TO '${duckPath(path)}' (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
  } finally {
    session.close();
    await unlink(jsonl).catch(() => undefined);
  }
}

/**
 * Read all rows from one or more Parquet files.
 *
 * @param paths - Absolute Parquet paths
 */
export async function readParquet(paths: readonly string[]): Promise<ParquetRow[]> {
  if (paths.length === 0) return [];
  const session = await openDuckDB();
  try {
    const list = paths.map((p) => `'${duckPath(p)}'`).join(", ");
    const rows = await duckQuery(
      session.conn,
      `SELECT * FROM read_parquet([${list}], union_by_name = true)`,
    );
    return rows as ParquetRow[];
  } finally {
    session.close();
  }
}

/**
 * Partition key from an event timestamp (day UTC).
 *
 * @param startedAt - Epoch-ms
 */
export function partitionKey(startedAt: number): string {
  const d = new Date(startedAt);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Build a partition object key.
 *
 * @param day - Partition day
 * @param id - Unique file id
 */
export function partitionObjectKey(day: string, id: string): string {
  return join("runs", `day=${day}`, `${id}.parquet`);
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
