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
const DEFAULT_FILES_IMAGE = "rustfs/rustfs:1.0.0-beta.11";
const DEFAULT_EMAIL_IMAGE = "axllent/mailpit:v1.22.3";

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
 * Prefer `docker` then `prod` for a driver map (compose ≈ production).
 *
 * @param map - Env driver map
 */
function dockerOrProdId(
  map:
    | {
        readonly docker?: DriverRef;
        readonly prod?: DriverRef;
      }
    | undefined,
): string | undefined {
  return driverId(map?.docker) ?? driverId(map?.prod);
}

/**
 * Derive default image pins from docker/prod driver protocols.
 *
 * Used when `oke.config.ts` omits `images` but declares postgres/redis (etc.)
 * so `oke dev -d` / `oke stack` / `oke docker` have something to run.
 *
 * @param config - Loaded config
 */
export function defaultImagesFromConfig(
  config: OkeConfig,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  const sql = dockerOrProdId(config.drivers?.store?.sql);
  const index = dockerOrProdId(config.drivers?.store?.index);
  const kv = dockerOrProdId(config.drivers?.store?.kv);
  const signal = dockerOrProdId(config.drivers?.signal);
  const clock = dockerOrProdId(config.drivers?.clock);

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

  const files = dockerOrProdId(config.drivers?.store?.files);
  const needsFiles =
    files === "s3" || (config.drivers?.prod ?? []).includes("s3");
  if (needsFiles) {
    out["store.files"] = DEFAULT_FILES_IMAGE;
  }

  const email = dockerOrProdId(config.drivers?.channel?.email);
  const needsEmail =
    email === "smtp" || (config.drivers?.prod ?? []).includes("smtp");
  if (needsEmail) {
    out["channel.email"] = DEFAULT_EMAIL_IMAGE;
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
 * so `oke dev -d` works on scaffolded templates without an explicit pin map.
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
  /** Active `drivers.*.docker` (→ prod) id. */
  readonly using: string;
  /** Driver that would use the container. */
  readonly container: string;
};

/**
 * Detect when `oke dev -d` containers will not back the app because the
 * `docker` driver profile still points at local/memory backends.
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
  const sqlDocker =
    driverId(config.drivers?.store?.sql?.docker) ??
    driverId(config.drivers?.store?.sql?.prod);
  const kvDocker =
    driverId(config.drivers?.store?.kv?.docker) ??
    driverId(config.drivers?.store?.kv?.prod);

  if (
    roles.has("store.sql") &&
    (sqlDocker === "sqlite" || sqlDocker === "memory" || sqlDocker === undefined)
  ) {
    out.push({
      label: "sql",
      using: sqlDocker ?? "unset",
      container: "postgres",
    });
  }
  if (
    roles.has("store.kv") &&
    (kvDocker === "memory" || kvDocker === undefined)
  ) {
    out.push({
      label: "kv",
      using: kvDocker ?? "memory",
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
