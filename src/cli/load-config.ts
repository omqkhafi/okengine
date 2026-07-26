/**
 * Load `oke.config.ts` / Manifest helpers for CLI commands.
 */

import { resolve } from "node:path";
import type { DriverRef, OkeConfig } from "../config/index.ts";
import type { Manifest } from "../manifest/types.ts";

/** Default image pins when `images` is omitted but prod drivers need containers. */
const DEFAULT_SQL_IMAGE = "postgres:18-alpine";
const DEFAULT_PGVECTOR_IMAGE = "pgvector/pgvector:pg17";
const DEFAULT_KV_IMAGE = "redis:8-alpine";

/**
 * Extract protocol id from a driver ref.
 *
 * @param ref - String or `{ driver }` object
 */
function driverId(ref: DriverRef | undefined): string | undefined {
  if (ref === undefined) return undefined;
  return typeof ref === "string" ? ref : ref.driver;
}

/**
 * Prefer `stack` then `prod` for a driver map (local server ≈ production).
 *
 * @param map - Env driver map
 */
function stackOrProdId(
  map: { readonly stack?: DriverRef; readonly prod?: DriverRef } | undefined,
): string | undefined {
  return driverId(map?.stack) ?? driverId(map?.prod);
}

/**
 * Derive default image pins from stack/prod driver protocols.
 *
 * Used when `oke.config.ts` omits `images` but declares postgres/redis (etc.)
 * so `oke dev -s` / `oke stack` / `oke docker` have something to run.
 *
 * @param config - Loaded config
 */
export function defaultImagesFromConfig(
  config: OkeConfig,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  const sql = stackOrProdId(config.drivers?.store?.sql);
  const index = stackOrProdId(config.drivers?.store?.index);
  const kv = stackOrProdId(config.drivers?.store?.kv);
  const signal = stackOrProdId(config.drivers?.signal);
  const clock = stackOrProdId(config.drivers?.clock);

  const needsSql =
    sql === "postgres" ||
    sql === "pgvector" ||
    index === "pgvector" ||
    signal === "postgres" ||
    clock === "postgres" ||
    (config.drivers?.prod ?? []).some(
      (p) => p === "postgres" || p === "pgvector",
    );

  if (needsSql) {
    out["store.sql"] =
      sql === "pgvector" || index === "pgvector"
        ? DEFAULT_PGVECTOR_IMAGE
        : DEFAULT_SQL_IMAGE;
  }

  const needsKv =
    kv === "redis" || (config.drivers?.prod ?? []).includes("redis");
  if (needsKv) {
    out["store.kv"] = DEFAULT_KV_IMAGE;
  }

  return out;
}

/** Result of loading project config. */
export interface LoadedConfig {
  readonly config: OkeConfig;
  readonly path: string;
}

/**
 * Load `oke.config.ts` (or `.js` / `.mts`) from a directory.
 *
 * @param cwd - Project root
 * @param configPath - Optional explicit path
 */
export async function loadOkeConfig(
  cwd = process.cwd(),
  configPath?: string,
): Promise<LoadedConfig> {
  const candidates = configPath
    ? [resolve(cwd, configPath)]
    : [
        resolve(cwd, "oke.config.ts"),
        resolve(cwd, "oke.config.mts"),
        resolve(cwd, "oke.config.js"),
      ];

  for (const path of candidates) {
    const file = Bun.file(path);
    if (!(await file.exists())) continue;
    const mod = (await import(path)) as { default?: OkeConfig };
    if (!mod.default || typeof mod.default !== "object") {
      throw new Error(`oke: ${path} must default-export defineConfig({...})`);
    }
    return { config: mod.default, path };
  }
  throw new Error(
    `oke: no oke.config.ts found in ${cwd} — create one with defineConfig()`,
  );
}

/**
 * Load a Manifest JSON document.
 *
 * @param path - Manifest path
 */
export async function loadManifest(path: string): Promise<Manifest> {
  const file = Bun.file(resolve(path));
  if (!(await file.exists())) {
    throw new Error(`oke: manifest not found: ${path}`);
  }
  return (await file.json()) as Manifest;
}

/**
 * Resolve images map from config or Manifest.
 *
 * When neither declares `images`, derive defaults from prod driver protocols
 * so `oke dev -s` works on scaffolded templates without an explicit pin map.
 *
 * @param config - Optional config
 * @param manifest - Optional manifest
 */
export function resolveImages(
  config?: OkeConfig,
  manifest?: Manifest,
): Readonly<Record<string, string>> {
  const explicit = config?.images ?? manifest?.images;
  if (explicit && Object.keys(explicit).length > 0) return explicit;
  if (config) return defaultImagesFromConfig(config);
  return {};
}

/** Compact driver mismatch for {@link formatStackSummary}. */
export type StackDriverMismatch = {
  /** Short label (`sql`, `kv`). */
  readonly label: string;
  /** Active `drivers.*.stack` (→ prod) id. */
  readonly using: string;
  /** Driver that would use the container. */
  readonly container: string;
};

/**
 * Detect when `oke dev -s` containers will not back the app because the
 * `stack` driver profile still points at local/memory backends.
 *
 * @param config - Loaded config
 * @param stackRoles - Roles being composed
 */
export function stackDevDriverMismatches(
  config: OkeConfig,
  stackRoles: readonly string[],
): readonly StackDriverMismatch[] {
  const roles = new Set(stackRoles);
  const out: StackDriverMismatch[] = [];
  const sqlStack =
    driverId(config.drivers?.store?.sql?.stack) ??
    driverId(config.drivers?.store?.sql?.prod);
  const kvStack =
    driverId(config.drivers?.store?.kv?.stack) ??
    driverId(config.drivers?.store?.kv?.prod);

  if (
    roles.has("store.sql") &&
    (sqlStack === "sqlite" || sqlStack === "memory" || sqlStack === undefined)
  ) {
    out.push({
      label: "sql",
      using: sqlStack ?? "unset",
      container: "postgres",
    });
  }
  if (
    roles.has("store.kv") &&
    (kvStack === "memory" || kvStack === undefined)
  ) {
    out.push({
      label: "kv",
      using: kvStack ?? "memory",
      container: "redis",
    });
  }
  return out;
}

/**
 * @deprecated Use {@link stackDevDriverMismatches} — kept for older call sites.
 * @param config - Loaded config
 * @param stackRoles - Roles being composed
 */
export function stackDevDriverWarnings(
  config: OkeConfig,
  stackRoles: readonly string[],
): readonly string[] {
  return stackDevDriverMismatches(config, stackRoles).map(
    (m) => `${m.label}: ${m.using}`,
  );
}
