/**
 * Load `oke.config.ts` / Manifest helpers for CLI commands.
 */

import { resolve } from "node:path";
import type { OkeConfig } from "../config/index.ts";
import type { Manifest } from "../manifest/types.ts";

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
 * @param config - Optional config
 * @param manifest - Optional manifest
 */
export function resolveImages(
  config?: OkeConfig,
  manifest?: Manifest,
): Readonly<Record<string, string>> {
  return config?.images ?? manifest?.images ?? {};
}
