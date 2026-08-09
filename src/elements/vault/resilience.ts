/**
 * Retry wrapper for Vault SQL — connection blips, not business errors.
 *
 * Audit writes must use the raw {@link SqlExec}: retrying an append can
 * duplicate rows and break the hash chain.
 */

import type { SqlExec } from "./storage.ts";

/** Tunables for {@link withResilience}. */
export interface RetryConfig {
  /** Attempts after the first failure. */
  readonly maxRetries: number;
  /** Initial backoff in milliseconds. */
  readonly baseDelayMs: number;
  /** Cap on exponential backoff. */
  readonly maxDelayMs: number;
  /** Substrings matched against `error.code` or `error.message`. */
  readonly retryableErrors: readonly string[];
}

/** Default Postgres / network blip codes. */
export const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
  retryableErrors: ["ECONNRESET", "ETIMEDOUT", "08006", "08003", "57P01"],
};

/**
 * Whether `error` looks like a transient connection failure.
 *
 * @param error - Caught value
 * @param config - Retry tunables
 */
export function isRetryableError(error: unknown, config: RetryConfig = DEFAULT_RETRY): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string | number; message?: string };
  const code =
    typeof record.code === "string" || typeof record.code === "number" ? String(record.code) : "";
  const message =
    typeof record.message === "string"
      ? record.message
      : error instanceof Error
        ? error.message
        : "";
  return config.retryableErrors.some(
    (retryable) => code.includes(retryable) || message.includes(retryable),
  );
}

/**
 * Sleep without journaling (CLI / adapter path, not a durable Flow step).
 *
 * @param ms - Delay
 */
export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Run `operation` with exponential backoff on retryable failures.
 *
 * @param operation - Thunk to retry
 * @param config - Retry tunables
 */
export async function withResilience<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === config.maxRetries) break;
      if (!isRetryableError(error, config)) throw error;
      const delay = Math.min(config.baseDelayMs * 2 ** attempt, config.maxDelayMs);
      console.warn(`[vault] Query failed (attempt ${attempt + 1}), retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Wrap a {@link SqlExec} so every `query` / `execute` retries on blips.
 *
 * Do **not** pass the result to {@link createSqlAuditWriter} — audit must
 * fail loudly or be best-effort without duplicate appends.
 *
 * @param db - Underlying SQL surface
 * @param config - Retry tunables
 */
export function createResilientSqlExec(db: SqlExec, config: RetryConfig = DEFAULT_RETRY): SqlExec {
  return {
    query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      return withResilience(() => db.query<T>(sql, params), config);
    },
    execute(sql: string, params?: unknown[]): Promise<void> {
      return withResilience(() => db.execute(sql, params), config);
    },
  };
}
