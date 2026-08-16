/**
 * Lazy runs binder — loaded only when runs are requested.
 */

import { resolve } from "node:path";
import { resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import { RUNS_DEFAULTS } from "../../config/driver-defaults.ts";
import {
  createRunsRuntime,
  type CreateRunsRuntimeOptions,
  type RunsDriverId,
  type RunsRuntime,
} from "../../runs/index.ts";
import { DEFAULT_RUNS_LOCAL_ROOT } from "../../runs/types.ts";
import type { BootOptions } from "../boot.ts";

/**
 * Narrow a config driver id to a known runs protocol.
 *
 * @param id - Resolved driver id
 */
function asRunsDriverId(id: string): RunsDriverId {
  if (id === "files" || id === "memory" || id === "postgres" || id === "clickhouse") {
    return id;
  }
  throw new Error(
    `oke boot: unknown runs driver "${id}" (expected files · memory · postgres · clickhouse)`,
  );
}

/**
 * Resolve `drivers.runs` for the active env.
 *
 * @param options - Boot options
 * @param env - Active {@link ConfigEnv}
 */
export function resolveRunsDriverId(options: BootOptions, env: ConfigEnv): RunsDriverId {
  return asRunsDriverId(resolveDriverId(options.config?.drivers?.runs, env, RUNS_DEFAULTS)!);
}

/**
 * Default Parquet keep window when `runs.keep` is unset.
 *
 * @param env - Active {@link ConfigEnv}
 */
export function defaultRunsKeep(env: ConfigEnv): string {
  if (env === "prod") return "30d";
  if (env === "dev") return "7d";
  return "forever";
}

/**
 * Construct and open a runs runtime.
 *
 * Explicit `oke({ runs: { driver } })` wins. Otherwise `drivers.runs` merges
 * onto {@link RUNS_DEFAULTS} (`files` in `dev`/`prod`, `memory` in `test`).
 *
 * @param options - Boot options (config + rootDir)
 * @param env - Active {@link ConfigEnv}
 * @param createOpts - Create options when `oke({ runs: { … } })` is not a runtime
 */
export async function bindRuns(
  options: BootOptions,
  env: ConfigEnv,
  createOpts?: CreateRunsRuntimeOptions,
): Promise<RunsRuntime> {
  const driver = createOpts?.driver ?? resolveRunsDriverId(options, env);
  const root = options.rootDir ?? process.cwd();
  const localRoot = createOpts?.localRoot ?? resolve(root, DEFAULT_RUNS_LOCAL_ROOT);
  const keep = createOpts?.retention?.keep ?? options.config?.runs?.keep ?? defaultRunsKeep(env);
  const runs = createRunsRuntime({
    ...createOpts,
    driver,
    localRoot,
    retention: {
      ...createOpts?.retention,
      keep,
    },
  });
  if (!runs.store) {
    await runs.open();
  }
  return runs;
}
