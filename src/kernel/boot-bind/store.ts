/**
 * Lazy store binder — loaded only when Store is declared.
 */

import {
  resolveDriverId,
  type ConfigEnv,
} from "../../config/index.ts";
import { memoryDrivers } from "../../drivers/memory.ts";
import { postgresDriver } from "../../drivers/postgres.ts";
import { redisDriver } from "../../drivers/redis.ts";
import { sqliteDriver } from "../../drivers/sqlite.ts";
import type { KvDriver, SqlDriver } from "../../drivers/types.ts";
import {
  createStoreRuntime,
  type StoreRuntime,
} from "../../elements/store.ts";
import type { StoreDecl } from "../../elements/store/declare.ts";
import type { BootOptions } from "../boot.ts"; // type-only — no cycle at runtime

/**
 * Construct a Store runtime and register facet declarations.
 *
 * In stack mode (`env === "stack"` / `OKE_STACK=1`), SQL/KV resolve from the
 * `stack` driver map (falling back to `prod`) and URLs from `.env.stack`.
 *
 * @param options - Boot options
 * @param env - Active environment
 * @param now - Clock
 * @param stack - Prefer compose URLs when opening postgres/redis
 */
export function bindStore(
  options: BootOptions,
  env: ConfigEnv,
  now: () => number,
  stack = false,
): StoreRuntime {
  const sqlId = resolveSqlDriverId(options, env, stack);
  const kvId = resolveKvDriverId(options, env, stack);
  const sqlUrl = sqlUrlFor(sqlId, stack);
  const kvUrl = kvUrlFor(kvId, stack);

  const sqlBindings: Record<
    string,
    { name: string; primary: { url: string } }
  > = {};
  const kvBindings: Record<string, { url?: string }> = {};

  for (const decl of options.stores ?? []) {
    if (isSqlDecl(decl)) {
      sqlBindings[decl.name] = {
        name: decl.name,
        primary: { url: sqlUrl },
      };
    } else if (isKvDecl(decl)) {
      kvBindings[decl.name] = kvUrl !== undefined ? { url: kvUrl } : {};
    }
  }

  const store = createStoreRuntime({
    drivers: {
      sql: sqlDriverFor(sqlId),
      kv: kvDriverFor(kvId),
      files: memoryDrivers.files,
      index: memoryDrivers.index,
    },
    sql: sqlBindings,
    kv: kvBindings,
    now,
  });
  for (const decl of options.stores ?? []) {
    store.register?.(decl);
  }
  return store;
}

/**
 * @param options - Boot options
 * @param env - Active env
 * @param stack - Stack mode
 */
export function resolveSqlDriverId(
  options: BootOptions,
  env: ConfigEnv,
  stack: boolean,
): string {
  const fromEnv = process.env.OKE_SQL_DRIVER?.trim();
  if (stack && fromEnv) return fromEnv;
  const resolved = resolveDriverId(options.config?.drivers?.store?.sql, env);
  if (resolved) return resolved;
  return stack ? "postgres" : "memory";
}

/**
 * @param options - Boot options
 * @param env - Active env
 * @param stack - Stack mode
 */
export function resolveKvDriverId(
  options: BootOptions,
  env: ConfigEnv,
  stack: boolean,
): string {
  const fromEnv = process.env.OKE_KV_DRIVER?.trim();
  if (stack && fromEnv) return fromEnv;
  const resolved = resolveDriverId(options.config?.drivers?.store?.kv, env);
  if (resolved) return resolved;
  return stack ? "redis" : "memory";
}

function sqlDriverFor(id: string): SqlDriver {
  switch (id) {
    case "postgres":
      return postgresDriver;
    case "sqlite":
      return sqliteDriver;
    case "memory":
      return memoryDrivers.sql;
    default:
      throw new Error(`oke boot: unknown sql driver "${id}"`);
  }
}

function kvDriverFor(id: string): KvDriver {
  switch (id) {
    case "redis":
      return redisDriver;
    case "memory":
      return memoryDrivers.kv;
    default:
      throw new Error(`oke boot: unknown kv driver "${id}"`);
  }
}

function sqlUrlFor(sqlId: string, stack: boolean): string {
  if (sqlId === "postgres") {
    const url =
      process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL ?? undefined;
    if (!url) {
      throw new Error(
        stack
          ? "oke boot: postgres driver needs DATABASE_URL (did `oke dev -s` write .env.stack?)"
          : "oke boot: postgres driver needs DATABASE_URL",
      );
    }
    return url;
  }
  if (sqlId === "sqlite") {
    return process.env.OKE_SQLITE_URL ?? ".oke/app.sqlite";
  }
  return ":memory:";
}

function kvUrlFor(kvId: string, stack: boolean): string | undefined {
  if (kvId !== "redis") return undefined;
  const url = process.env.REDIS_URL ?? process.env.OKE_STORE_KV_URL ?? undefined;
  if (!url) {
    throw new Error(
      stack
        ? "oke boot: redis driver needs REDIS_URL (did `oke dev -s` write .env.stack?)"
        : "oke boot: redis driver needs REDIS_URL",
    );
  }
  return url;
}

function isSqlDecl(
  decl: StoreDecl,
): decl is Extract<StoreDecl, { facet: "sql" }> {
  return decl.facet === "sql";
}

function isKvDecl(
  decl: StoreDecl,
): decl is Extract<StoreDecl, { facet: "kv" }> {
  return decl.facet === "kv";
}
