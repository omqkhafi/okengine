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
 * Derive default image pins from prod driver protocols.
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
  const sql = driverId(config.drivers?.store?.sql?.prod);
  const index = driverId(config.drivers?.store?.index?.prod);
  const kv = driverId(config.drivers?.store?.kv?.prod);
  const signal = driverId(config.drivers?.signal?.prod);
  const clock = driverId(config.drivers?.clock?.prod);

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
