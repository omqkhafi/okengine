/**
 * Lazy store binder — loaded only when Store is declared.
 */

import { resolveDomainDdlMode, resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import {
  STORE_FILES_DEFAULTS,
  STORE_KV_DEFAULTS,
  STORE_SQL_DEFAULTS,
} from "../../config/driver-defaults.ts";
import { fsDriver } from "../../drivers/fs.ts";
import { meilisearchDriver } from "../../drivers/meilisearch.ts";
import { memoryDrivers } from "../../drivers/memory.ts";
import { pgliteDriver } from "../../drivers/pglite.ts";
import { pgvectorDriver } from "../../drivers/pgvector.ts";
import { postgresDriver } from "../../drivers/postgres.ts";
import { redisDriver } from "../../drivers/redis.ts";
import { s3Driver } from "../../drivers/s3.ts";
import type { FilesDriver, IndexDriver, KvDriver, SqlDriver } from "../../drivers/types.ts";
import { createStoreRuntime, type StoreRuntime } from "../../elements/store.ts";
import type { StoreDecl } from "../../elements/store/declare.ts";
import { emitBootWarn } from "../../runtime/boot-warn.ts";
import type { BootOptions } from "../boot.ts"; // type-only — no cycle at runtime

/**
 * Construct a Store runtime and register facet declarations.
 *
 * With compose infra (`OKE_DOCKER=1` / `oke dev`), SQL/KV URLs come from
 * `.env.local`. `env: "test"` uses PGLite (`memory://` by default).
 *
 * @param options - Boot options
 * @param env - Active environment
 * @param now - Clock
 * @param docker - Prefer compose URLs when opening postgres/redis
 */
let filesFsWarned = false;
let kvCacheShapedWarned = false;
let kvMemoryDurableWarned = false;

/** Test helper — reset the one-shot `fs` multi-instance warn. */
export function resetFilesFsWarnForTests(): void {
  filesFsWarned = false;
}

/** Test helper — reset durable-KV boot warns. */
export function resetKvDurableWarnsForTests(): void {
  kvCacheShapedWarned = false;
  kvMemoryDurableWarned = false;
}

/**
 * Warn once when `drivers.store.files` is `fs` — per-process (or per-pod)
 * filesystem visibility under horizontal scale.
 */
function warnFilesFsMultiInstance(): void {
  if (filesFsWarned) return;
  filesFsWarned = true;
  emitBootWarn(
    'oke boot: drivers.store.files "fs" is single-host — each instance sees its own ' +
      "filesystem (temp root when unbound). For horizontal scale use drivers.store.files s3 " +
      "(or an explicitly shared volume root, still single-host semantics).",
  );
}

/**
 * Warn once: default KV namespaces are cache-shaped (no AOF) unless
 * `{ durable: true }` persists them in SQL (`oke_kv`).
 */
function warnKvCacheShaped(names: readonly string[]): void {
  if (kvCacheShapedWarned) return;
  kvCacheShapedWarned = true;
  const listed = names
    .slice(0, 4)
    .map((n) => `"${n}"`)
    .join(", ");
  const extra = names.length > 4 ? ` (and ${String(names.length - 4)} more)` : "";
  emitBootWarn(
    `oke boot: store.kv ${listed}${extra} is cache-shaped — a Redis recreate drops keys ` +
      "(no AOF). Declare `{ durable: true }` on a separate namespace to persist in " +
      "your SQL database (`oke_kv`).",
  );
}

/**
 * Warn once: in-process memory SQL cannot honor `{ durable: true }`.
 */
function warnKvMemoryDurable(names: readonly string[]): void {
  if (kvMemoryDurableWarned) return;
  kvMemoryDurableWarned = true;
  const listed = names.map((n) => `"${n}"`).join(", ");
  emitBootWarn(
    `oke boot: store.kv ${listed} declared { durable: true } but drivers.store.sql is ` +
      '"memory" — keys are process-local and vanish on restart. Use drivers.store.sql ' +
      "postgres with DATABASE_URL.",
  );
}

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
  if (filesId === "fs") warnFilesFsMultiInstance();
  const kvDecls = (options.stores ?? []).filter(isKvDecl);
  const durableKvDecls = kvDecls.filter((d) => d.durable === true);
  const cacheKvDecls = kvDecls.filter((d) => d.durable !== true);
  if (durableKvDecls.length > 0 && sqlId === "postgres") {
    const url = process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL;
    if (!url) {
      throw new Error(
        docker
          ? "oke boot: durable store.kv needs DATABASE_URL (did `oke dev` write .env.local?)"
          : "oke boot: durable store.kv needs DATABASE_URL",
      );
    }
  }
  const sqlUrl = sqlUrlFor(sqlId, docker, env);
  const kvUrl = kvUrlFor(kvId, docker);
  const filesRoot = filesRootFor(filesId);
  if (kvId === "redis" && env !== "test" && cacheKvDecls.length > 0) {
    warnKvCacheShaped(cacheKvDecls.map((d) => d.name));
  }
  if (sqlId === "memory" && env !== "test" && durableKvDecls.length > 0) {
    warnKvMemoryDurable(durableKvDecls.map((d) => d.name));
  }

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
      if (decl.durable === true) {
        kvBindings[decl.name] = {};
      } else {
        kvBindings[decl.name] = kvUrl !== undefined ? { url: kvUrl } : {};
      }
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
    sqlUrl,
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
  // Defaults cover every ConfigEnv key, so this is never undefined.
  return resolveDriverId(options.config?.drivers?.store?.sql, env, STORE_SQL_DEFAULTS)!;
}

/**
 * @param options - Boot options
 * @param env - Active env
 * @param docker - Docker mode
 */
export function resolveKvDriverId(options: BootOptions, env: ConfigEnv, docker: boolean): string {
  const fromEnv = process.env.OKE_KV_DRIVER?.trim();
  if (docker && fromEnv) return fromEnv;
  // Defaults cover every ConfigEnv key, so this is never undefined.
  return resolveDriverId(options.config?.drivers?.store?.kv, env, STORE_KV_DEFAULTS)!;
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
  // Defaults cover every ConfigEnv key, so this is never undefined.
  return resolveDriverId(options.config?.drivers?.store?.files, env, STORE_FILES_DEFAULTS)!;
}

/**
 * Index driver — same resolution chain as sql/kv/files. Defaults to `memory`;
 * a configured `pgvector` is honoured at real boot (and fails loud if its
 * SQL engine or peer is missing — never silently back to memory).
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
    case "meilisearch":
      return meilisearchDriver;
    default:
      throw new Error(`oke boot: unknown index driver "${id}"`);
  }
}

function sqlUrlFor(sqlId: string, docker: boolean, env: ConfigEnv): string {
  if (sqlId === "postgres") {
    const url = process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL ?? undefined;
    if (!url) {
      throw new Error(
        docker
          ? "oke boot: postgres driver needs DATABASE_URL (did `oke dev` write .env.local?)"
          : "oke boot: postgres driver needs DATABASE_URL",
      );
    }
    return url;
  }
  if (sqlId === "pglite") {
    return process.env.OKE_PGLITE_URL ?? (env === "test" ? "memory://" : ".oke/pgdata");
  }
  // In-process `memory` SQL driver ignores URL; keep a non-path token so a
  // mis-wired pglite connect never creates a literal `./:memory:` datadir.
  return "memory://";
}

function kvUrlFor(kvId: string, docker: boolean): string | undefined {
  if (kvId !== "redis") return undefined;
  const url = process.env.REDIS_URL ?? process.env.OKE_STORE_KV_URL ?? undefined;
  if (!url) {
    throw new Error(
      docker
        ? "oke boot: redis driver needs REDIS_URL (did `oke dev` write .env.local?)"
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
        ? "oke boot: meilisearch index needs OKE_STORE_INDEX_URL (did `oke dev` write .env.local?)"
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
