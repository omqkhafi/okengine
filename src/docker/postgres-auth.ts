/**
 * Detect a leftover Postgres volume whose init password does not match
 * `.env.local` / compose env (`password authentication failed for user "oke"`).
 */

/**
 * True when a driver / Bun.SQL error is a Postgres password rejection.
 *
 * @param err - Caught value
 */
export function isPostgresPasswordAuthFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /password authentication failed/i.test(msg);
}

/**
 * Probe `url` with a dedicated connection. `true` only on password rejection
 * — connection-refused / starting-up stay `false` so boot can wait.
 *
 * @param url - `DATABASE_URL` / `OKE_STORE_SQL_URL`
 */
export async function postgresUrlPasswordRejected(url: string): Promise<boolean> {
  const { connectPostgres } = await import("../drivers/postgres.ts");
  try {
    const conn = await connectPostgres({ url, pool: { max: 1 } });
    try {
      await conn.exec("SELECT 1");
    } finally {
      await conn.close().catch(() => {});
    }
    return false;
  } catch (err) {
    return isPostgresPasswordAuthFailure(err);
  }
}
