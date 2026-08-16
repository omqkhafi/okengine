/**
 * Store SQL engine telemetry — pg_stat_statements + pg_locks (read-only).
 *
 * Distinct from the SQL console and from Runs SQL. Query TEXT is a named
 * limitation ({@link STORE_SQL_STATS_PII_GAP}); live lock activity is
 * collapsed unless reveal is audited.
 */

import type { ResourceRef } from "../../manifest/types.ts";
import type { SqlStoreHandle, StoreRuntime } from "../../elements/store.ts";

/** Named limitation for engine-native query text (statements + live locks). */
export const STORE_SQL_STATS_PII_GAP = "StoreSqlStatsQueryTextGap" as const;

/** Preload missing — `CREATE EXTENSION` is not enough. */
export const PG_STAT_STATEMENTS_NOT_PRELOADED = "PgStatStatementsNotPreloaded" as const;

/** Driver or vendor does not expose pg_stat_statements. */
export const PG_STAT_STATEMENTS_UNSUPPORTED = "PgStatStatementsUnsupported" as const;

/** Extension files missing or CREATE failed for a reason other than preload. */
export const PG_STAT_STATEMENTS_NOT_CREATED = "PgStatStatementsNotCreated" as const;

/** Statements row cap. */
export const STORE_SQL_STATS_ROW_LIMIT = 200;

/** Lock poll interval the UI should match (infra-list band). */
export const STORE_SQL_LOCKS_POLL_MS = 10_000;

/** Mean exec time (ms) counted as a slow statement. */
export const STORE_SQL_SLOW_MS = 100;

/** Placeholder when live `pg_stat_activity.query` is collapsed. */
export const STORE_SQL_LOCK_QUERY_REDACTED = "[redacted]";

const STATS_SQL = `SELECT
  queryid::text AS queryid,
  query,
  calls,
  total_exec_time,
  mean_exec_time,
  min_exec_time,
  max_exec_time,
  rows,
  shared_blks_hit,
  shared_blks_read
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT ${STORE_SQL_STATS_ROW_LIMIT}`;

const STATS_SQL_LEGACY = `SELECT
  queryid::text AS queryid,
  query,
  calls,
  total_time AS total_exec_time,
  mean_time AS mean_exec_time,
  min_time AS min_exec_time,
  max_time AS max_exec_time,
  rows,
  shared_blks_hit,
  shared_blks_read
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT ${STORE_SQL_STATS_ROW_LIMIT}`;

const LOCKS_SQL = `SELECT
  blocked.pid AS blocked_pid,
  blocked.usename AS blocked_user,
  blocked.query AS blocked_query,
  blocked.query_start AS blocked_at,
  blocking.pid AS blocking_pid,
  blocking.usename AS blocking_user,
  blocking.query AS blocking_query,
  blocking.state AS blocking_state,
  blocking.wait_event_type,
  blocking.wait_event
FROM pg_stat_activity AS blocked
JOIN pg_locks AS bl ON bl.pid = blocked.pid AND NOT bl.granted
JOIN pg_locks AS gl
  ON gl.locktype = bl.locktype
 AND gl.database IS NOT DISTINCT FROM bl.database
 AND gl.relation IS NOT DISTINCT FROM bl.relation
 AND gl.page IS NOT DISTINCT FROM bl.page
 AND gl.tuple IS NOT DISTINCT FROM bl.tuple
 AND gl.virtualxid IS NOT DISTINCT FROM bl.virtualxid
 AND gl.transactionid IS NOT DISTINCT FROM bl.transactionid
 AND gl.classid IS NOT DISTINCT FROM bl.classid
 AND gl.objid IS NOT DISTINCT FROM bl.objid
 AND gl.objsubid IS NOT DISTINCT FROM bl.objsubid
 AND gl.pid IS DISTINCT FROM bl.pid
 AND gl.granted
JOIN pg_stat_activity AS blocking ON blocking.pid = gl.pid
WHERE blocked.pid <> pg_backend_pid()`;

const ADVISE_SQL = `SELECT
  startup_cost_before,
  startup_cost_after,
  total_cost_before,
  total_cost_after,
  index_statements,
  errors
FROM index_advisor(?)`;

const ADVISOR_AVAILABLE_SQL = `SELECT name, installed_version
FROM pg_available_extensions
WHERE name IN ('index_advisor', 'hypopg')`;

/** Structured telemetry failure (HTTP error code = {@link StoreSqlStatsError.code}). */
export class StoreSqlStatsError extends Error {
  readonly code:
    | typeof PG_STAT_STATEMENTS_NOT_PRELOADED
    | typeof PG_STAT_STATEMENTS_UNSUPPORTED
    | typeof PG_STAT_STATEMENTS_NOT_CREATED;

  /**
   * @param code - Structured code
   * @param message - Engine or classifier message
   */
  constructor(
    code:
      | typeof PG_STAT_STATEMENTS_NOT_PRELOADED
      | typeof PG_STAT_STATEMENTS_UNSUPPORTED
      | typeof PG_STAT_STATEMENTS_NOT_CREATED,
    message: string,
  ) {
    super(message);
    this.name = "StoreSqlStatsError";
    this.code = code;
  }
}

/** One pg_stat_statements row (normalized column names). */
export interface StoreSqlStatementRow {
  readonly queryid: string | null;
  readonly query: string | null;
  readonly calls: number;
  readonly totalExecMs: number;
  readonly meanExecMs: number;
  readonly minExecMs: number;
  readonly maxExecMs: number;
  readonly rows: number;
  readonly sharedBlksHit: number;
  readonly sharedBlksRead: number;
  readonly cacheHitRate: number | null;
}

/** Cluster KPIs derived from the statement set. */
export interface StoreSqlStatsKpis {
  readonly slowQueries: number;
  readonly cacheHitRate: number | null;
  readonly avgRowsPerCall: number | null;
}

/** Index advisor availability on this engine. */
export interface StoreSqlAdvisorStatus {
  readonly available: boolean;
  readonly installed: boolean;
  readonly hypopgAvailable: boolean;
}

/** `QUERY /console/store/sql/stats` payload. */
export interface StoreSqlStatsResult {
  readonly statements: readonly StoreSqlStatementRow[];
  readonly kpis: StoreSqlStatsKpis;
  readonly limitation: typeof STORE_SQL_STATS_PII_GAP;
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly advisor: StoreSqlAdvisorStatus;
}

/** One blocking pair. */
export interface StoreSqlLockRow {
  readonly blockedPid: number | null;
  readonly blockedUser: string | null;
  readonly blockedQuery: string | null;
  readonly blockedAt: string | null;
  readonly blockingPid: number | null;
  readonly blockingUser: string | null;
  readonly blockingQuery: string | null;
  readonly blockingState: string | null;
  readonly waitEventType: string | null;
  readonly waitEvent: string | null;
}

/** `QUERY /console/store/sql/locks` payload. */
export interface StoreSqlLocksResult {
  readonly rows: readonly StoreSqlLockRow[];
  readonly masked: boolean;
  readonly limitation: typeof STORE_SQL_STATS_PII_GAP;
  readonly pollingMs: typeof STORE_SQL_LOCKS_POLL_MS;
}

/** `POST /console/store/sql/advise` payload. */
export interface StoreSqlAdviseResult {
  readonly startupCostBefore: unknown;
  readonly startupCostAfter: unknown;
  readonly totalCostBefore: unknown;
  readonly totalCostAfter: unknown;
  readonly indexStatements: readonly string[];
  readonly errors: readonly string[];
}

/**
 * Map an engine error to a structured stats code.
 *
 * @param err - Driver / SQL failure
 */
export function classifyPgStatStatementsError(err: unknown): StoreSqlStatsError {
  if (err instanceof StoreSqlStatsError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (
    lower.includes("shared_preload") ||
    lower.includes("must be loaded") ||
    lower.includes("must be preloaded")
  ) {
    return new StoreSqlStatsError(PG_STAT_STATEMENTS_NOT_PRELOADED, message);
  }
  if (
    lower.includes("unimplemented") ||
    lower.includes("not yet supported") ||
    lower.includes("is not supported")
  ) {
    return new StoreSqlStatsError(PG_STAT_STATEMENTS_UNSUPPORTED, message);
  }
  if (
    lower.includes("does not exist") ||
    lower.includes("undefined_table") ||
    lower.includes("unknown function") ||
    lower.includes("index_advisor")
  ) {
    return new StoreSqlStatsError(PG_STAT_STATEMENTS_NOT_CREATED, message);
  }
  return new StoreSqlStatsError(PG_STAT_STATEMENTS_UNSUPPORTED, message);
}

/**
 * Collapse live `pg_stat_activity.query` unless reveal is on.
 *
 * @param query - Raw activity text
 * @param reveal - Audited cleartext
 */
export function maskLockActivityQuery(query: unknown, reveal: boolean): string | null {
  if (query == null) return null;
  const text = String(query);
  if (reveal) return text;
  return text.length === 0 ? text : STORE_SQL_LOCK_QUERY_REDACTED;
}

/**
 * KPI rollup from statement rows.
 *
 * @param rows - Normalized statements
 */
export function computeStatsKpis(rows: readonly StoreSqlStatementRow[]): StoreSqlStatsKpis {
  let slow = 0;
  let hit = 0;
  let read = 0;
  let rowSum = 0;
  let callSum = 0;
  for (const row of rows) {
    if (row.meanExecMs >= STORE_SQL_SLOW_MS) slow += 1;
    hit += row.sharedBlksHit;
    read += row.sharedBlksRead;
    rowSum += row.rows;
    callSum += row.calls;
  }
  const io = hit + read;
  return {
    slowQueries: slow,
    cacheHitRate: io > 0 ? hit / io : null,
    avgRowsPerCall: callSum > 0 ? rowSum / callSum : null,
  };
}

/**
 * Read pg_stat_statements (+ optional CREATE EXTENSION) and KPIs.
 *
 * @param runtime - Store runtime
 * @param ref - SQL store ref (`sql:db`)
 */
export async function queryStoreSqlStats(
  runtime: StoreRuntime,
  ref: ResourceRef,
): Promise<StoreSqlStatsResult> {
  const handle = await openSql(runtime, ref);
  assertPostgresDriver(handle);
  const rawRows = await readStatStatements(handle);
  const statements = rawRows.map(normalizeStatementRow);
  const advisor = await readAdvisorStatus(handle);
  return {
    statements,
    kpis: computeStatsKpis(statements),
    limitation: STORE_SQL_STATS_PII_GAP,
    rowCount: statements.length,
    truncated: statements.length >= STORE_SQL_STATS_ROW_LIMIT,
    advisor,
  };
}

/**
 * Read lock blocking pairs. Live query text is collapsed unless `revealPii`.
 *
 * @param runtime - Store runtime
 * @param ref - SQL store ref
 * @param options - Reveal
 */
export async function queryStoreSqlLocks(
  runtime: StoreRuntime,
  ref: ResourceRef,
  options: { readonly revealPii?: boolean } = {},
): Promise<StoreSqlLocksResult> {
  const handle = await openSql(runtime, ref);
  assertPostgresDriver(handle);
  const reveal = options.revealPii === true;
  try {
    const raw = await handle.raw(LOCKS_SQL);
    return {
      rows: raw.map((row) => normalizeLockRow(row, reveal)),
      masked: !reveal,
      limitation: STORE_SQL_STATS_PII_GAP,
      pollingMs: STORE_SQL_LOCKS_POLL_MS,
    };
  } catch (err) {
    throw classifyPgStatStatementsError(err);
  }
}

/**
 * Run `index_advisor(query)` on a dedicated handle.
 *
 * @param runtime - Store runtime
 * @param ref - SQL store ref
 * @param query - Captured statement text (typically `$n` fingerprints)
 */
/**
 * Normalise captured statement text for `index_advisor(query)`.
 * Trailing semicolons are stripped; additional statements are rejected.
 *
 * @param query - Statement text
 */
export function assertAdviseQuery(query: string): string {
  const trimmed = query.trim().replace(/;+\s*$/, "");
  if (trimmed.length === 0) {
    throw new StoreSqlStatsError(PG_STAT_STATEMENTS_NOT_CREATED, "advise requires query text");
  }
  if (trimmed.includes(";")) {
    throw new StoreSqlStatsError(
      PG_STAT_STATEMENTS_NOT_CREATED,
      "Query must not contain a semicolon",
    );
  }
  return trimmed;
}

export async function adviseStoreSqlIndex(
  runtime: StoreRuntime,
  ref: ResourceRef,
  query: string,
): Promise<StoreSqlAdviseResult> {
  const handle = await openSql(runtime, ref);
  assertPostgresDriver(handle);
  const trimmed = assertAdviseQuery(query);
  try {
    const rows = await handle.raw(ADVISE_SQL, [trimmed]);
    const row = rows[0] ?? {};
    return {
      startupCostBefore: row.startup_cost_before ?? null,
      startupCostAfter: row.startup_cost_after ?? null,
      totalCostBefore: row.total_cost_before ?? null,
      totalCostAfter: row.total_cost_after ?? null,
      indexStatements: asStringArray(row.index_statements),
      errors: asStringArray(row.errors),
    };
  } catch (err) {
    throw classifyPgStatStatementsError(err);
  }
}

async function openSql(runtime: StoreRuntime, ref: ResourceRef): Promise<SqlStoreHandle> {
  return (await runtime.openRef(ref, { effects: { reads: [ref] } })) as SqlStoreHandle;
}

function assertPostgresDriver(handle: SqlStoreHandle): void {
  if (handle.driverId !== "postgres") {
    throw new StoreSqlStatsError(
      PG_STAT_STATEMENTS_UNSUPPORTED,
      `SQL stats require the postgres driver (got ${handle.driverId})`,
    );
  }
}

async function readStatStatements(
  handle: SqlStoreHandle,
): Promise<readonly Record<string, unknown>[]> {
  try {
    return await handle.raw(STATS_SQL);
  } catch (first) {
    const classified = classifyPgStatStatementsError(first);
    if (classified.code === PG_STAT_STATEMENTS_NOT_PRELOADED) throw classified;
    if (classified.code === PG_STAT_STATEMENTS_UNSUPPORTED) {
      try {
        return await handle.raw(STATS_SQL_LEGACY);
      } catch (legacyErr) {
        const legacy = classifyPgStatStatementsError(legacyErr);
        if (legacy.code === PG_STAT_STATEMENTS_NOT_CREATED) {
          await tryCreateStatStatements(handle);
          try {
            return await handle.raw(STATS_SQL);
          } catch {
            return await handle.raw(STATS_SQL_LEGACY);
          }
        }
        throw legacy;
      }
    }
    if (classified.code === PG_STAT_STATEMENTS_NOT_CREATED) {
      await tryCreateStatStatements(handle);
      try {
        return await handle.raw(STATS_SQL);
      } catch {
        return await handle.raw(STATS_SQL_LEGACY);
      }
    }
    throw classified;
  }
}

async function tryCreateStatStatements(handle: SqlStoreHandle): Promise<void> {
  try {
    await handle.raw("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
  } catch (err) {
    throw classifyPgStatStatementsError(err);
  }
}

async function readAdvisorStatus(handle: SqlStoreHandle): Promise<StoreSqlAdvisorStatus> {
  try {
    const rows = await handle.raw(ADVISOR_AVAILABLE_SQL);
    let available = false;
    let installed = false;
    let hypopgAvailable = false;
    for (const row of rows) {
      const name = typeof row.name === "string" ? row.name : "";
      const installedVersion = row.installed_version;
      if (name === "hypopg") hypopgAvailable = true;
      if (name === "index_advisor") {
        available = true;
        installed = installedVersion != null && String(installedVersion).length > 0;
      }
    }
    return { available, installed, hypopgAvailable };
  } catch {
    return { available: false, installed: false, hypopgAvailable: false };
  }
}

function normalizeStatementRow(row: Record<string, unknown>): StoreSqlStatementRow {
  const hit = asNumber(row.shared_blks_hit);
  const read = asNumber(row.shared_blks_read);
  const io = hit + read;
  return {
    queryid: row.queryid == null ? null : String(row.queryid),
    query: row.query == null ? null : String(row.query),
    calls: asNumber(row.calls),
    totalExecMs: asNumber(row.total_exec_time),
    meanExecMs: asNumber(row.mean_exec_time),
    minExecMs: asNumber(row.min_exec_time),
    maxExecMs: asNumber(row.max_exec_time),
    rows: asNumber(row.rows),
    sharedBlksHit: hit,
    sharedBlksRead: read,
    cacheHitRate: io > 0 ? hit / io : null,
  };
}

function normalizeLockRow(row: Record<string, unknown>, reveal: boolean): StoreSqlLockRow {
  return {
    blockedPid: asNullableNumber(row.blocked_pid),
    blockedUser: asNullableString(row.blocked_user),
    blockedQuery: maskLockActivityQuery(row.blocked_query, reveal),
    blockedAt: asNullableString(row.blocked_at),
    blockingPid: asNullableNumber(row.blocking_pid),
    blockingUser: asNullableString(row.blocking_user),
    blockingQuery: maskLockActivityQuery(row.blocking_query, reveal),
    blockingState: asNullableString(row.blocking_state),
    waitEventType: asNullableString(row.wait_event_type),
    waitEvent: asNullableString(row.wait_event),
  };
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = asNumber(value);
  return n === 0 && (value === "" || value === false) ? null : n;
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function asStringArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((part) => part.replaceAll(/^"|"$/g, "").trim())
        .filter((part) => part.length > 0);
    }
  }
  return [];
}
