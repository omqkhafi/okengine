/**
 * drizzle-kit child-env overlay — resolved from the configured `store.sql`
 * driver for the active env (never guessed from `DATABASE_URL` presence).
 */

import { resolveDriverId, type ConfigEnv, type OkeConfig } from "../config/index.ts";
import {
  drizzleDialectFromSqlDriver,
  type OkeDrizzleKitDialect,
} from "../drivers/drizzle-dialect.ts";
import { parseDotenv } from "../drivers/vault-dotenv-parse.ts";
import { resolveComposeEnvPath } from "../elements/vault/chain.ts";

/** Resolved drizzle env context for one project env. */
export interface DrizzleKitEnvContext {
  /** Active env used for driver resolution. */
  readonly env: ConfigEnv;
  /** drizzle-kit dialect (from `SQL_DRIVER_TO_DRIZZLE_DIALECT`). */
  readonly dialect: OkeDrizzleKitDialect;
  /** Env overlay for the drizzle-kit child process. */
  readonly overlay: Record<string, string>;
}

/**
 * Load `docker/.env.docker` (or legacy `.env.docker`) as a name→value map.
 *
 * @param cwd - Project root
 */
export async function readComposeEnv(cwd: string): Promise<Map<string, string>> {
  const { path } = resolveComposeEnvPath(cwd);
  const file = Bun.file(path);
  if (!(await file.exists())) return new Map();
  try {
    return parseDotenv(await file.text());
  } catch {
    return new Map();
  }
}

/**
 * Fill unset `process.env` keys from compose `.env.docker` (never overwrites).
 *
 * SQL / Redis binders read `process.env` directly — Vault can resolve the
 * same file, but `oke db seed` must hydrate env before `app.boot()`.
 *
 * @param cwd - Project root
 * @returns Keys that were applied
 */
export async function applyComposeEnvToProcess(cwd: string): Promise<readonly string[]> {
  const compose = await readComposeEnv(cwd);
  const applied: string[] = [];
  for (const [key, value] of compose) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}

/**
 * Resolve the drizzle-kit env context for a project + env.
 *
 * Dialect comes from the configured driver via the exhaustive
 * `SQL_DRIVER_TO_DRIZZLE_DIALECT` map — a missing/unsupported driver id is a
 * compile-time gap there, and a clear runtime error here (never a silent
 * fallback).
 *
 * @param cwd - Project root
 * @param config - Loaded `oke.config.ts` (null → postgres/dev defaults)
 * @param env - Active {@link ConfigEnv}
 */
export async function resolveDrizzleKitEnv(
  cwd: string,
  config: OkeConfig | null | undefined,
  env: ConfigEnv,
): Promise<DrizzleKitEnvContext> {
  const driverId = resolveDriverId(config?.drivers?.store?.sql, env) ?? "postgres";
  if (driverId !== "postgres" && driverId !== "pglite") {
    throw new Error(
      `oke db: store.sql driver "${driverId}" is not supported by drizzle-kit (postgres | pglite)`,
    );
  }
  const dialect = drizzleDialectFromSqlDriver(driverId);

  const compose = env === "dev" ? await readComposeEnv(cwd) : new Map<string, string>();

  const overlay: Record<string, string> = { OKE_DRIZZLE_DIALECT: dialect };
  if (driverId === "pglite") {
    const url =
      process.env.OKE_PGLITE_URL ??
      compose.get("OKE_PGLITE_URL") ??
      (env === "test" ? "memory://" : ".oke/pgdata");
    overlay.OKE_PGLITE_URL = url;
    // drizzle-kit still wants a postgres-shaped URL for dialect postgresql when
    // not using PGlite kit plugins — prefer DATABASE_URL from compose for push.
    const pgUrl =
      process.env.DATABASE_URL ?? compose.get("DATABASE_URL") ?? compose.get("OKE_STORE_SQL_URL");
    if (pgUrl !== undefined) overlay.DATABASE_URL = pgUrl;
  } else {
    const url =
      process.env.DATABASE_URL ?? compose.get("DATABASE_URL") ?? compose.get("OKE_STORE_SQL_URL");
    if (url !== undefined) overlay.DATABASE_URL = url;
  }
  return { env, dialect, overlay };
}
