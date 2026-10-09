/**
 * Race-safe `CREATE … IF NOT EXISTS`.
 *
 * Two sessions can both pass the existence check and then one loses with
 * `23505` (pg_type / index name), `42P07` (duplicate table), or `XX000`
 * `tuple concurrently updated`. A transaction lock serializes the create.
 * Surfaces with no `begin` treat those outcomes as success.
 */

/** Fixed int4 keys, one per relation. Held only until the create transaction commits. */
export const PG_DDL_LOCK = {
  journalRuns: 724001,
  journalEntries: 724002,
  journalRunsWake: 724003,
  journalRunsLease: 724004,
  idempotency: 724005,
  idempotencyExpires: 724006,
  signalMessages: 724011,
  signalWrites: 724012,
  signalLiveCreated: 724013,
  signalDeliveryDbAt: 724014,
  crons: 724021,
  horizontalWrites: 724061,
  rlsHelpers: 724080,
} as const;

const DUPLICATE_RELATION = new Set(["23505", "42P07"]);

/**
 * True when Postgres reports a relation that already exists.
 *
 * @param err - Thrown driver error
 */
export function isDuplicateRelation(err: unknown): boolean {
  if (codesOf(err).some((code) => DUPLICATE_RELATION.has(code))) return true;
  return messagesOf(err).some((message) => message.includes("tuple concurrently updated"));
}

/**
 * Take the relation lock. Must run on the same transaction as the `CREATE`.
 *
 * @param sql - Transaction SQL
 * @param key - {@link PG_DDL_LOCK} value
 */
export async function lockRelation(
  sql: { exec(statement: string): Promise<unknown> },
  key: number,
): Promise<void> {
  await sql.exec(`SELECT pg_advisory_xact_lock(${key})`);
}

/**
 * Run one `CREATE`. `23505`, `42P07`, and a concurrent catalog update mean the other session won.
 *
 * @param sql - SQL surface with no transaction helper
 * @param statement - `CREATE TABLE` or `CREATE INDEX`
 */
export async function execIfNotExists(
  sql: { exec(statement: string): Promise<unknown> },
  statement: string,
): Promise<void> {
  try {
    await sql.exec(statement);
  } catch (err) {
    if (!isDuplicateRelation(err)) throw err;
  }
}

function codesOf(err: unknown, depth = 0): string[] {
  if (depth > 4 || err === null || typeof err !== "object") return [];
  const row = err as { code?: unknown; errno?: unknown; cause?: unknown; message?: unknown };
  const found: string[] = [];
  if (typeof row.code === "string") found.push(row.code);
  if (typeof row.errno === "string") found.push(row.errno);
  if (typeof row.errno === "number") found.push(String(row.errno));
  if (typeof row.message === "string") {
    const match = /\b(23505|42P07)\b/.exec(row.message);
    if (match?.[1]) found.push(match[1]);
  }
  if (row.cause !== undefined && row.cause !== err) found.push(...codesOf(row.cause, depth + 1));
  return found;
}

function messagesOf(err: unknown, depth = 0): string[] {
  if (depth > 4 || err === null || typeof err !== "object") return [];
  const row = err as { message?: unknown; cause?: unknown };
  const found: string[] = [];
  if (typeof row.message === "string") found.push(row.message);
  if (row.cause !== undefined && row.cause !== err) found.push(...messagesOf(row.cause, depth + 1));
  return found;
}
