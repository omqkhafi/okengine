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
 * sqlite fallback).
 *
 * @param cwd - Project root
 * @param config - Loaded `oke.config.ts` (null → sqlite/local defaults)
 * @param env - Active env (`local` | `docker` for dev tooling)
 */
export async function resolveDrizzleKitEnv(
  cwd: string,
  config: OkeConfig | null | undefined,
  env: ConfigEnv,
): Promise<DrizzleKitEnvContext> {
  const driverId = resolveDriverId(config?.drivers?.store?.sql, env) ?? "sqlite";
  if (driverId !== "sqlite" && driverId !== "postgres") {
    throw new Error(
      `oke db: store.sql driver "${driverId}" is not supported by drizzle-kit (sqlite | postgres)`,
    );
  }
  const dialect = drizzleDialectFromSqlDriver(driverId);

  const compose = env === "docker" ? await readComposeEnv(cwd) : new Map<string, string>();

  const overlay: Record<string, string> = { OKE_DRIZZLE_DIALECT: dialect };
  if (dialect === "postgresql") {
    const url =
      process.env.DATABASE_URL ?? compose.get("DATABASE_URL") ?? compose.get("OKE_STORE_SQL_URL");
    if (url !== undefined) overlay.DATABASE_URL = url;
  } else {
    const url =
      process.env.OKE_SQLITE_URL ?? compose.get("OKE_SQLITE_URL") ?? "file:.oke/app.sqlite";
    overlay.OKE_SQLITE_URL = url;
  }
  return { env, dialect, overlay };
}
