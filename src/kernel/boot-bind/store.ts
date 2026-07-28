/**
 * Lazy store binder — loaded only when Store is declared.
 */

import {
  resolveDriverId,
  type ConfigEnv,
} from "../../config/index.ts";
import { fsDriver } from "../../drivers/fs.ts";
import { memoryDrivers } from "../../drivers/memory.ts";
import { postgresDriver } from "../../drivers/postgres.ts";
import { redisDriver } from "../../drivers/redis.ts";
import { s3Driver } from "../../drivers/s3.ts";
import { sqliteDriver } from "../../drivers/sqlite.ts";
import type { FilesDriver, KvDriver, SqlDriver } from "../../drivers/types.ts";
import {
  createStoreRuntime,
  type StoreRuntime,
} from "../../elements/store.ts";
import type { StoreDecl } from "../../elements/store/declare.ts";
import type { BootOptions } from "../boot.ts"; // type-only — no cycle at runtime

/**
 * Construct a Store runtime and register facet declarations.
 *
 * In docker mode (`env === "docker"` / `OKE_DOCKER=1`), SQL/KV/files resolve
 * from the `docker` driver map (falling back to `prod`) and URLs from
 * `.env.docker`.
 *
 * @param options - Boot options
 * @param env - Active environment
 * @param now - Clock
 * @param docker - Prefer compose URLs when opening postgres/redis/s3
 */
export function bindStore(
  options: BootOptions,
  env: ConfigEnv,
  now: () => number,
  docker = false,
): StoreRuntime {
  const sqlId = resolveSqlDriverId(options, env, docker);
  const kvId = resolveKvDriverId(options, env, docker);
  const filesId = resolveFilesDriverId(options, env, docker);
  const sqlUrl = sqlUrlFor(sqlId, docker);
  const kvUrl = kvUrlFor(kvId, docker);
  const filesBinding = filesBindingFor(filesId, docker);

  const sqlBindings: Record<
    string,
    { name: string; primary: { url: string } }
  > = {};
  const kvBindings: Record<string, { url?: string }> = {};
  const fileBindings: Record<
    string,
    {
      root?: string;
      endpoint?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
    }
  > = {};

  for (const decl of options.stores ?? []) {
    if (isSqlDecl(decl)) {
      sqlBindings[decl.name] = {
        name: decl.name,
        primary: { url: sqlUrl },
      };
    } else if (isKvDecl(decl)) {
      kvBindings[decl.name] = kvUrl !== undefined ? { url: kvUrl } : {};
    } else if (isFilesDecl(decl)) {
      fileBindings[decl.name] = { ...filesBinding };
    }
  }

  const store = createStoreRuntime({
    drivers: {
      sql: sqlDriverFor(sqlId),
      kv: kvDriverFor(kvId),
      files: filesDriverFor(filesId),
      index: memoryDrivers.index,
    },
    sql: sqlBindings,
    kv: kvBindings,
    files: fileBindings,
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
 * @param docker - Docker mode
 */
export function resolveSqlDriverId(
  options: BootOptions,
  env: ConfigEnv,
  docker: boolean,
): string {
  const fromEnv = process.env.OKE_SQL_DRIVER?.trim();
  if (docker && fromEnv) return fromEnv;
  const resolved = resolveDriverId(options.config?.drivers?.store?.sql, env);
  if (resolved) return resolved;
  return docker ? "postgres" : "memory";
}

/**
 * @param options - Boot options
 * @param env - Active env
 * @param docker - Docker mode
 */
export function resolveKvDriverId(
  options: BootOptions,
  env: ConfigEnv,
  docker: boolean,
): string {
  const fromEnv = process.env.OKE_KV_DRIVER?.trim();
  if (docker && fromEnv) return fromEnv;
  const resolved = resolveDriverId(options.config?.drivers?.store?.kv, env);
  if (resolved) return resolved;
  return docker ? "redis" : "memory";
}

/**
 * @param options - Boot options
 * @param env - Active env
 * @param docker - Docker mode
 */
export function resolveFilesDriverId(
  options: BootOptions,
  env: ConfigEnv,
  docker: boolean,
): string {
  const fromEnv = process.env.OKE_FILES_DRIVER?.trim();
  if (docker && fromEnv) return fromEnv;
  const resolved = resolveDriverId(options.config?.drivers?.store?.files, env);
  if (resolved) return resolved;
  return "memory";
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

function filesDriverFor(id: string): FilesDriver {
  switch (id) {
    case "s3":
      return s3Driver;
    case "fs":
      return fsDriver;
    case "memory":
      return memoryDrivers.files;
    default:
      throw new Error(`oke boot: unknown files driver "${id}"`);
  }
}

function sqlUrlFor(sqlId: string, docker: boolean): string {
  if (sqlId === "postgres") {
    const url =
      process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL ?? undefined;
    if (!url) {
      throw new Error(
        docker
          ? "oke boot: postgres driver needs DATABASE_URL (did `oke dev -d` write .env.docker?)"
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

function kvUrlFor(kvId: string, docker: boolean): string | undefined {
  if (kvId !== "redis") return undefined;
  const url = process.env.REDIS_URL ?? process.env.OKE_STORE_KV_URL ?? undefined;
  if (!url) {
    throw new Error(
      docker
        ? "oke boot: redis driver needs REDIS_URL (did `oke dev -d` write .env.docker?)"
        : "oke boot: redis driver needs REDIS_URL",
    );
  }
  return url;
}

/**
 * Resolve S3 open options from compose / process env.
 *
 * @param filesId - Files driver id
 * @param docker - Docker mode
 */
function filesBindingFor(
  filesId: string,
  docker: boolean,
): {
  root?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
} {
  if (filesId === "fs") {
    return { root: process.env.OKE_FILES_ROOT?.trim() || ".oke/files" };
  }
  if (filesId !== "s3") return {};

  const raw =
    process.env.OKE_STORE_FILES_URL?.trim() ||
    process.env.S3_ENDPOINT?.trim() ||
    process.env.AWS_ENDPOINT_URL?.trim();
  const accessKeyId =
    process.env.OKE_STORE_FILES_ACCESS_KEY?.trim() ||
    process.env.OKE_STORE_FILES_USER?.trim() ||
    process.env.AWS_ACCESS_KEY_ID?.trim() ||
    process.env.S3_ACCESS_KEY?.trim();
  const secretAccessKey =
    process.env.OKE_STORE_FILES_SECRET_KEY?.trim() ||
    process.env.OKE_STORE_FILES_PASSWORD?.trim() ||
    process.env.AWS_SECRET_ACCESS_KEY?.trim() ||
    process.env.S3_SECRET_KEY?.trim();
  const bucket =
    process.env.OKE_STORE_FILES_BUCKET?.trim() ||
    process.env.OKE_STORE_FILES_DB?.trim() ||
    process.env.S3_BUCKET?.trim() ||
    "oke";

  let endpoint: string | undefined;
  let user = accessKeyId;
  let pass = secretAccessKey;
  if (raw) {
    try {
      const u = new URL(raw);
      endpoint = `${u.protocol}//${u.host}`;
      if (u.username) user = decodeURIComponent(u.username);
      if (u.password) pass = decodeURIComponent(u.password);
      const pathBucket = u.pathname.replace(/^\//, "").split("/")[0];
      if (pathBucket) {
        return {
          root: pathBucket,
          endpoint,
          ...(user ? { accessKeyId: user } : {}),
          ...(pass ? { secretAccessKey: pass } : {}),
        };
      }
    } catch {
      endpoint = raw;
    }
  }

  if (!endpoint && docker) {
    throw new Error(
      "oke boot: s3 files driver needs OKE_STORE_FILES_URL (did `oke dev -d` start RustFS?)",
    );
  }

  return {
    root: bucket,
    ...(endpoint ? { endpoint } : {}),
    ...(user ? { accessKeyId: user } : {}),
    ...(pass ? { secretAccessKey: pass } : {}),
  };
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

function isFilesDecl(
  decl: StoreDecl,
): decl is Extract<StoreDecl, { facet: "files" }> {
  return decl.facet === "files";
}
