/**
 * Canonical vault resolution chain — shared by app boot and Console.
 *
 * Spec order (console §9.8 · four-applications Vault):
 * `process.env` → `.env.local` → `.env.docker` → driver → (optional) `dev` fallback.
 *
 * Compose env lives at `docker/.env.docker`. Legacy project-root `.env.docker`
 * is consulted when absent (soft-compat).
 * When the vault driver pin is `sops`, the driver layer opens `secrets.enc.json`.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { envVaultDriver } from "../../drivers/vault-env.ts";
import { memoryVaultDriver } from "../../drivers/vault-memory.ts";
import { sopsVaultDriver } from "../../drivers/vault-sops.ts";
import type { VaultChainLayer } from "./runtime.ts";

/** Default relative path for the SOPS JSON bag. */
export const DEFAULT_SOPS_PATH = "secrets.enc.json";

/** Options for {@link defaultVaultResolutionChain}. */
export interface DefaultVaultChainOptions {
  /**
   * Seed values for the terminal `driver` layer (tests / Console host inject).
   * Empty by default — real values come from env files or `dev:` fallbacks.
   * Ignored when {@link driverId} is `"sops"`.
   */
  readonly seed?: Readonly<Record<string, string>>;
  /**
   * Protocol id for the terminal driver layer (`sops` opens the encrypted bag;
   * anything else keeps an in-memory seed bag).
   */
  readonly driverId?: string;
  /** `AGE-SECRET-KEY-…` identity (defaults to `AGE_SECRET_KEY` / `OKE_AGE_IDENTITY`). */
  readonly ageIdentity?: string;
  /** Path to SOPS JSON (defaults to {@link DEFAULT_SOPS_PATH} / `OKE_SOPS_PATH`). */
  readonly sopsPath?: string;
}

/**
 * Resolve age identity from options or process env.
 *
 * @param options - Chain options
 */
export function resolveAgeIdentity(
  options: Pick<DefaultVaultChainOptions, "ageIdentity"> = {},
): string | undefined {
  const fromOpt = options.ageIdentity?.trim();
  if (fromOpt) return fromOpt;
  const fromEnv =
    process.env.AGE_SECRET_KEY?.trim() ||
    process.env.OKE_AGE_IDENTITY?.trim();
  return fromEnv || undefined;
}

/**
 * Resolve the SOPS JSON path for a project root.
 *
 * @param root - Project root
 * @param options - Chain options
 */
export function resolveSopsPath(
  root: string,
  options: Pick<DefaultVaultChainOptions, "sopsPath"> = {},
): string {
  if (options.sopsPath) return resolve(root, options.sopsPath);
  const fromEnv = process.env.OKE_SOPS_PATH?.trim();
  if (fromEnv) {
    return fromEnv.startsWith("/") ? fromEnv : resolve(root, fromEnv);
  }
  return resolve(root, DEFAULT_SOPS_PATH);
}

/** Canonical relative path for compose stack credentials. */
export const COMPOSE_ENV_REL = "docker/.env.docker";

/**
 * Resolve the compose-env path: prefer `docker/.env.docker`, then legacy
 * project-root `.env.docker`.
 *
 * @param root - Project root
 */
export function resolveComposeEnvPath(root: string): {
  readonly path: string;
  readonly source: ".env.docker";
} {
  const dockerPath = resolve(root, COMPOSE_ENV_REL);
  if (existsSync(dockerPath)) {
    return { path: dockerPath, source: ".env.docker" };
  }
  const legacyDocker = resolve(root, ".env.docker");
  if (existsSync(legacyDocker)) {
    return { path: legacyDocker, source: ".env.docker" };
  }
  return { path: dockerPath, source: ".env.docker" };
}

/**
 * Build the default resolution chain for a project root.
 *
 * Used by {@link import("../../kernel/boot-bind/vault.ts").bindVault} and
 * {@link import("../../console/server/vault.ts").createManifestVaultRuntime}
 * so the Console never displays a source the running app does not consult.
 *
 * @param cwd - Project root (paths for `.env.local` / `docker/.env.docker`)
 * @param options - Optional driver-layer seed / sops wiring
 */
export function defaultVaultResolutionChain(
  cwd: string,
  options: DefaultVaultChainOptions = {},
): readonly VaultChainLayer[] {
  const root = resolve(cwd);
  const compose = resolveComposeEnvPath(root);
  const driverLayer: VaultChainLayer =
    options.driverId === "sops"
      ? {
          driver: sopsVaultDriver,
          source: "driver",
          options: {
            path: resolveSopsPath(root, options),
            ageIdentity: resolveAgeIdentity(options),
          },
        }
      : {
          driver: memoryVaultDriver,
          source: "driver",
          options: { secrets: { ...(options.seed ?? {}) } },
        };
  return [
    { driver: envVaultDriver, source: "process.env" },
    {
      driver: envVaultDriver,
      source: ".env.local",
      options: { path: resolve(root, ".env.local") },
    },
    {
      driver: envVaultDriver,
      source: compose.source,
      options: { path: compose.path },
    },
    driverLayer,
  ];
}
