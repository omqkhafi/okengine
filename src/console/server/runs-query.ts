/**
 * Console-only sandboxed query over persisted `.oke/runs` Parquet.
 *
 * Does not call Console `fx.runs.query` (memory driver / chrome events).
 */

import { DuckQueryTimeoutError } from "../../runs/duckdb.ts";
import type { RunsRuntime } from "../../runs/runtime.ts";
import type { RunsRow } from "../../runs/types.ts";
import {
  guardRunsQuerySql,
  RUNS_QUERY_PII_GAP,
  RUNS_QUERY_ROW_LIMIT,
  RUNS_QUERY_TIMEOUT_MS,
} from "./runs-query-guard.ts";
import { maskRunsQueryRows } from "./runs-query-mask.ts";

/** Stable limitation id shown in the UI banner. */
export { RUNS_QUERY_PII_GAP, RUNS_QUERY_ROW_LIMIT, RUNS_QUERY_TIMEOUT_MS };

/** Success payload for `POST /console/runs/query`. */
export interface ConsoleRunsQueryResult {
  readonly rows: readonly RunsRow[];
  readonly truncated: boolean;
  readonly rowCount: number;
  readonly masked: "column-keys";
  readonly durationMs: number;
  readonly limitation: typeof RUNS_QUERY_PII_GAP;
  readonly injectedLimit: boolean;
}

/** Guard / engine failures mapped to Console error codes. */
export class ConsoleRunsQueryError extends Error {
  readonly code: "QueryRejected" | "QueryTimeout" | "QueryFailed";
  readonly reason: string;

  constructor(code: ConsoleRunsQueryError["code"], reason: string) {
    super(reason);
    this.name = "ConsoleRunsQueryError";
    this.code = code;
    this.reason = reason;
  }
}

/** Options for {@link runConsoleRunsQuery}. */
export interface RunConsoleRunsQueryInput {
  readonly runtime: RunsRuntime;
  readonly sql: string;
  readonly piiFields: ReadonlySet<string>;
  readonly revealPii?: boolean;
  readonly timeoutMs?: number;
  readonly maxRows?: number;
}

/**
 * Guard, sandbox, timeout, cap, and conservatively mask a runs SQL statement.
 *
 * @param input - Runtime + SQL + PII policy
 */
export async function runConsoleRunsQuery(
  input: RunConsoleRunsQueryInput,
): Promise<ConsoleRunsQueryResult> {
  const guarded = guardRunsQuerySql(input.sql);
  if (!guarded.ok) {
    throw new ConsoleRunsQueryError("QueryRejected", guarded.reason);
  }
  const timeoutMs = input.timeoutMs ?? RUNS_QUERY_TIMEOUT_MS;
  const maxRows = input.maxRows ?? RUNS_QUERY_ROW_LIMIT;
  const started = Date.now();
  let rows: RunsRow[];
  try {
    rows = await input.runtime.query(guarded.sql, {
      sandbox: true,
      timeoutMs,
      maxRows: maxRows + 1,
    });
  } catch (err) {
    if (err instanceof DuckQueryTimeoutError || err instanceof ConsoleRunsQueryError) {
      throw err instanceof ConsoleRunsQueryError
        ? err
        : new ConsoleRunsQueryError("QueryTimeout", `timeout:${err.timeoutMs}`);
    }
    throw new ConsoleRunsQueryError("QueryFailed", sanitizeQueryError(err));
  }
  const truncated = rows.length > maxRows;
  const sliced = truncated ? rows.slice(0, maxRows) : rows;
  const masked = maskRunsQueryRows(sliced, input.piiFields, input.revealPii === true);
  return {
    rows: masked,
    truncated,
    rowCount: masked.length,
    masked: "column-keys",
    durationMs: Date.now() - started,
    limitation: RUNS_QUERY_PII_GAP,
    injectedLimit: guarded.injectedLimit,
  };
}

/**
 * Drop filesystem paths from DuckDB errors before they reach the operator.
 *
 * @param err - Engine error
 */
export function sanitizeQueryError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/(?:\/|\\)[^\s:'"]+/g, "[path]").slice(0, 240);
}
