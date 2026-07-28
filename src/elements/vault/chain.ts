/**
 * Canonical vault compose-env path resolution — shared by app boot and Console.
 *
 * Compose credentials live at `docker/.env.docker`. Legacy project-root
 * `.env.docker` is consulted when absent (soft-compat).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { VaultResolutionSource } from "./runtime.ts";

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
  readonly source: Extract<VaultResolutionSource, ".env.docker">;
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
