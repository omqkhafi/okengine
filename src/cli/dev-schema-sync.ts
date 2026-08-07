/**
 * Shared local↔docker schema sync pipeline for `oke mode` and `oke dev`
 * one-shot start. Ensures artefacts, emits for the active dialect, then
 * pushes via drizzle-kit. Data planes stay isolated — no row copying.
 */

import { resolve } from "node:path";
import { resolveDriverId, type ConfigEnv, type OkeConfig } from "../config/index.ts";
import {
  DEFAULT_DOCKER_DIR,
  deriveInfrastructure,
  loadExistingStackControls,
  loadExistingStackCredentials,
  stackAppSlug,
  stackInstanceId,
  writeDerivedFiles,
} from "../docker/index.ts";
import { drizzleDialectFromSqlDriver } from "../drivers/drizzle-dialect.ts";
import { ensureDrizzleConfig } from "./ensure-drizzle-config.ts";
import { runDb } from "./db.ts";
import { loadOkeConfig, resolveImages } from "./load-config.ts";

/** Options for {@link syncDevSchema}. */
export interface DevSchemaSyncOptions {
  /** Write output (default: stdout). */
  readonly write?: (text: string) => void;
  /** Skip emitting `schema.generated.ts` (tests). */
  readonly skipEmit?: boolean;
  /** Injectable push (tests). Default: `runDb("push", ...)`. */
  readonly pushFn?: (cwd: string, env: ConfigEnv) => Promise<number>;
  /** Derive docker infra without running compose (tests). */
  readonly dryRun?: boolean;
  /**
   * Skip the “compose env ready” line — `oke dev -d` already brought the
   * stack up and prints {@link import("../term.ts").formatStackSummary}.
   */
  readonly quietComposeReady?: boolean;
}

/** Outcome of {@link syncDevSchema}. */
export interface DevSchemaSyncResult {
  readonly env: ConfigEnv;
  readonly dialect: "sqlite" | "postgresql";
  readonly pushed: boolean;
  readonly code: number;
}

/**
 * Resolve the SQL driver id + drizzle dialect for an env from config.
 *
 * @param config - Loaded oke config
 * @param env - Active env
 */
export function sqlDialectForEnv(
  config: OkeConfig | null | undefined,
  env: ConfigEnv,
): { readonly driverId: string; readonly dialect: "sqlite" | "postgresql" } {
  const driverId = resolveDriverId(config?.drivers?.store?.sql, env) ?? "sqlite";
  if (driverId !== "sqlite" && driverId !== "postgres") {
    throw new Error(
      `store.sql driver "${driverId}" is not supported by drizzle-kit (sqlite | postgres)`,
    );
  }
  return { driverId, dialect: drizzleDialectFromSqlDriver(driverId) };
}

/**
 * Ensure docker compose artefacts + credentials exist. Fails loudly with a
 * clear hint when images are not configured (no silent retry loop).
 *
 * @param cwd - Project root
 * @param config - Loaded oke config
 * @param write - Output
 */
async function ensureDockerStack(
  cwd: string,
  config: OkeConfig,
  write: (text: string) => void,
  quietComposeReady = false,
): Promise<void> {
  const images = resolveImages(config);
  if (Object.keys(images).length === 0) {
    throw new Error(
      "docker mode: no images configured — set `images` in oke.config.ts (or prod drivers postgres/redis for defaults)",
    );
  }
  const roles = Object.keys(images);
  const instanceId = stackInstanceId(cwd);
  const appSlug = stackAppSlug(cwd);
  const credentials = await loadExistingStackCredentials(cwd, roles);
  const controls = await loadExistingStackControls(cwd);
  const derived = deriveInfrastructure({
    images,
    app: appSlug,
    prod: false,
    includeApp: false,
    composeDir: DEFAULT_DOCKER_DIR,
    instanceId,
    ...(credentials ? { credentials } : {}),
    ...(controls ? { controls } : {}),
    host: "127.0.0.1",
  });
  await writeDerivedFiles(derived, resolve(cwd, DEFAULT_DOCKER_DIR), { writeStackEnv: true });
  if (!quietComposeReady) {
    write(
      "oke: docker compose env ready under docker/.env.docker (start containers with `oke dev -d` or docker compose up)\n",
    );
  }
}

/**
 * Ensure artefacts, emit for the active dialect, and push schema for an env.
 * Returns a one-line summary outcome. Docker mode also ensures compose env
 * exists (writes `docker/.env.docker`) before pushing to the live DB.
 *
 * @param cwd - Project root
 * @param env - Target env (`local` | `docker`)
 * @param options - Injectables
 */
export async function syncDevSchema(
  cwd: string,
  env: ConfigEnv,
  options: DevSchemaSyncOptions = {},
): Promise<DevSchemaSyncResult> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const loaded = await loadOkeConfig(cwd).catch(() => null);
  const config = loaded?.config;

  await ensureDrizzleConfig(cwd);

  const { dialect } = sqlDialectForEnv(config, env);

  if (env === "docker") {
    if (!config) {
      throw new Error("docker mode: oke.config.ts not found");
    }
    await ensureDockerStack(cwd, config, write, options.quietComposeReady === true);
  }

  const push =
    options.pushFn ??
    (async (projectCwd, envArg) =>
      runDb("push", { cwd: projectCwd, env: envArg, write, skipEmit: options.skipEmit }));

  const code = await push(cwd, env);
  return { env, dialect, pushed: code === 0, code };
}
