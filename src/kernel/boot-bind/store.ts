/**
 * Lazy store binder — loaded only when Store is declared.
 */

import { resolveDomainDdlMode, resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import { fsDriver } from "../../drivers/fs.ts";
import { libsqlDriver, libsqlIndexDriver } from "../../drivers/libsql.ts";
import { meilisearchDriver } from "../../drivers/meilisearch.ts";
import { memoryDrivers } from "../../drivers/memory.ts";
import { pgliteDriver } from "../../drivers/pglite.ts";
import { pgvectorDriver } from "../../drivers/pgvector.ts";
import { postgresDriver } from "../../drivers/postgres.ts";
import { redisDriver } from "../../drivers/redis.ts";
import { s3Driver } from "../../drivers/s3.ts";
import { sqliteDriver } from "../../drivers/sqlite.ts";
import type { FilesDriver, IndexDriver, KvDriver, SqlDriver } from "../../drivers/types.ts";
import { createStoreRuntime, type StoreRuntime } from "../../elements/store.ts";
import type { StoreDecl } from "../../elements/store/declare.ts";
import type { BootOptions } from "../boot.ts"; // type-only — no cycle at runtime

/**
 * Construct a Store runtime and register facet declarations.
 *
 * In docker mode (`env === "docker"` / `OKE_DOCKER=1`), SQL/KV resolve from the
 * `docker` driver map (falling back to `prod`) and URLs from `docker/.env.docker`.
 *
 * @param options - Boot options
 * @param env - Active environment
 * @param now - Clock
 * @param docker - Prefer compose URLs when opening postgres/redis
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
  const indexId = resolveIndexDriverId(options, env, docker);
  const sqlUrl = sqlUrlFor(sqlId, docker);
  const kvUrl = kvUrlFor(kvId, docker);
  const filesRoot = filesRootFor(filesId);

  const sqlBindings: Record<string, { name: string; primary: { url: string } }> = {};
  const kvBindings: Record<string, { url?: string }> = {};
  const filesBindings: Record<string, { root?: string }> = {};
  const indexBindings: Record<string, { url?: string; apiKey?: string }> = {};

  for (const decl of options.stores ?? []) {
    if (isSqlDecl(decl)) {
      sqlBindings[decl.name] = {
        name: decl.name,
        primary: { url: sqlUrl },
      };
    } else if (isKvDecl(decl)) {
      kvBindings[decl.name] = kvUrl !== undefined ? { url: kvUrl } : {};
    } else if (isFilesDecl(decl)) {
      filesBindings[decl.name] = filesRoot !== undefined ? { root: filesRoot } : {};
    } else if (isIndexDecl(decl)) {
      // SQL-backed index drivers share the sql facet's URL — the runtime opens
      // one connection and hands it to both (never a second, redundant one).
      // Meilisearch is a standalone HTTP service: its own URL + key, never sqlUrl.
      if (indexId === "memory") {
        indexBindings[decl.name] = {};
      } else if (indexId === "meilisearch") {
        indexBindings[decl.name] = { url: indexUrlFor(docker), apiKey: indexApiKeyFor() };
      } else {
        indexBindings[decl.name] = { url: sqlUrl };
      }
    }
  }

  const autoPush = resolveAutoPush(options);
  const domainDdl = resolveDomainDdlMode(env, autoPush);

  const store = createStoreRuntime({
    drivers: {
      sql: sqlDriverFor(sqlId),
      kv: kvDriverFor(kvId),
      files: filesDriverFor(filesId),
      index: indexDriverFor(indexId),
    },
    sql: sqlBindings,
    kv: kvBindings,
    files: filesBindings,
    index: indexBindings,
    now,
    domainDdl,
  });
  for (const decl of options.stores ?? []) {
    store.register?.(decl);
  }
  return store;
}

/**
 * Effective `db.autoPush` — config default true; `OKE_DB_AUTO_PUSH=0` opts out.
 *
 * @param options - Boot options
 */
function resolveAutoPush(options: BootOptions): boolean {
  const fromEnv = process.env.OKE_DB_AUTO_PUSH?.trim();
  if (fromEnv === "0" || fromEnv === "false") return false;
  if (fromEnv === "1" || fromEnv === "true") return true;
  return options.config?.db?.autoPush !== false;
}

/**
 * @param options - Boot options
 * @param env - Active env
 * @param docker - Docker mode
 */
export function resolveSqlDriverId(options: BootOptions, env: ConfigEnv, docker: boolean): string {
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
export function resolveKvDriverId(options: BootOptions, env: ConfigEnv, docker: boolean): string {
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
  return docker ? "s3" : "memory";
}

/**
 * Index driver — same resolution chain as sql/kv/files. Defaults to `memory`;
 * a configured `pgvector` / `libsql` is honoured at real boot (and fails loud
 * if its SQL engine or peer is missing — never silently back to memory).
 *
 * @param options - Boot options
 * @param env - Active env
 * @param docker - Docker mode
 */
export function resolveIndexDriverId(
  options: BootOptions,
  env: ConfigEnv,
  docker: boolean,
): string {
  const fromEnv = process.env.OKE_INDEX_DRIVER?.trim();
  if (docker && fromEnv) return fromEnv;
  const resolved = resolveDriverId(options.config?.drivers?.store?.index, env);
  if (resolved) return resolved;
  return "memory";
}

function sqlDriverFor(id: string): SqlDriver {
  switch (id) {
    case "postgres":
      return postgresDriver;
    case "sqlite":
      return sqliteDriver;
    case "libsql":
      return libsqlDriver;
    case "pglite":
      return pgliteDriver;
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

/**
 * Single id → index driver switch — shared by `bindStore` and the Console's
 * Manifest runtime so resolution can never drift into two maintained copies.
 */
export function indexDriverFor(id: string): IndexDriver {
  switch (id) {
    case "memory":
      return memoryDrivers.index;
    case "pgvector":
      return pgvectorDriver;
    case "libsql":
      return libsqlIndexDriver;
    case "meilisearch":
      return meilisearchDriver;
    default:
      throw new Error(`oke boot: unknown index driver "${id}"`);
  }
}

function sqlUrlFor(sqlId: string, docker: boolean): string {
  if (sqlId === "postgres") {
    const url = process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL ?? undefined;
    if (!url) {
      throw new Error(
        docker
          ? "oke boot: postgres driver needs DATABASE_URL (did `oke dev -d` write docker/.env.docker?)"
          : "oke boot: postgres driver needs DATABASE_URL",
      );
    }
    return url;
  }
  if (sqlId === "sqlite") {
    return process.env.OKE_SQLITE_URL ?? ".oke/app.sqlite";
  }
  if (sqlId === "libsql") {
    return process.env.OKE_LIBSQL_URL ?? ".oke/app.libsql";
  }
  if (sqlId === "pglite") {
    return process.env.OKE_PGLITE_URL ?? ".oke/pgdata";
  }
  return ":memory:";
}

function kvUrlFor(kvId: string, docker: boolean): string | undefined {
  if (kvId !== "redis") return undefined;
  const url = process.env.REDIS_URL ?? process.env.OKE_STORE_KV_URL ?? undefined;
  if (!url) {
    throw new Error(
      docker
        ? "oke boot: redis driver needs REDIS_URL (did `oke dev -d` write docker/.env.docker?)"
        : "oke boot: redis driver needs REDIS_URL",
    );
  }
  return url;
}

function filesRootFor(filesId: string): string | undefined {
  if (filesId !== "s3") return undefined;
  return process.env.S3_BUCKET ?? process.env.OKE_STORE_FILES_DB ?? undefined;
}

/** Meilisearch base URL — standalone HTTP service, fail loud when missing. */
function indexUrlFor(docker: boolean): string {
  const url = process.env.OKE_STORE_INDEX_URL ?? undefined;
  if (!url) {
    throw new Error(
      docker
        ? "oke boot: meilisearch index needs OKE_STORE_INDEX_URL (did `oke dev -d` write docker/.env.docker?)"
        : "oke boot: meilisearch index needs OKE_STORE_INDEX_URL",
    );
  }
  return url;
}

/** Meilisearch API / master key. */
function indexApiKeyFor(): string | undefined {
  return process.env.OKE_STORE_INDEX_KEY ?? process.env.MEILI_MASTER_KEY ?? undefined;
}

function isSqlDecl(decl: StoreDecl): decl is Extract<StoreDecl, { facet: "sql" }> {
  return decl.facet === "sql";
}

function isKvDecl(decl: StoreDecl): decl is Extract<StoreDecl, { facet: "kv" }> {
  return decl.facet === "kv";
}

function isFilesDecl(decl: StoreDecl): decl is Extract<StoreDecl, { facet: "files" }> {
  return decl.facet === "files";
}

function isIndexDecl(decl: StoreDecl): decl is Extract<StoreDecl, { facet: "index" }> {
  return decl.facet === "index";
}
