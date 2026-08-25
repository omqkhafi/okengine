/**
 * Bench infra helpers — live-env resolution, file waits, jsonl loading.
 *
 * Env gating mirrors `src/kernel/horizontal.integration.test.ts`:
 * OKE_TEST_POSTGRES_URL (or OKE_TEST_POSTGRES=1 + DATABASE_URL /
 * OKE_STORE_SQL_URL) AND OKE_TEST_REDIS_URL (or REDIS_URL). Credentials are
 * resolved at runtime from the environment only — never printed or logged.
 */

export const LIVE_PG =
  process.env.OKE_TEST_POSTGRES_URL?.trim() ||
  (process.env.OKE_TEST_POSTGRES === "1"
    ? (process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL)?.trim()
    : undefined);

export const LIVE_REDIS =
  process.env.OKE_TEST_REDIS_URL?.trim() || process.env.REDIS_URL?.trim() || undefined;

export function resolveLivePg(): string | undefined {
  return LIVE_PG;
}

export function resolveLiveRedis(): string | undefined {
  return LIVE_REDIS;
}

/** Both live Postgres and Redis, or undefined — the bench gate. */
export function liveInfra(): { pg: string; redis: string } | undefined {
  return LIVE_PG && LIVE_REDIS ? { pg: LIVE_PG, redis: LIVE_REDIS } : undefined;
}

/** Poll until `path` exists (or timeout). Mirrors the horizontal test helper. */
export async function waitForFile(path: string, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await Bun.file(path).exists()) return true;
    await Bun.sleep(20);
  }
  return false;
}

/** Poll until `cond()` returns true (or timeout). */
export async function waitFor(
  cond: () => Promise<boolean>,
  timeoutMs = 20_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return true;
    await Bun.sleep(20);
  }
  return false;
}

/** Read a JSONL file into parsed records; missing file → empty array. */
export async function loadJsonl<T = Record<string, unknown>>(path: string): Promise<T[]> {
  if (!(await Bun.file(path).exists())) return [];
  return (await Bun.file(path).text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}
