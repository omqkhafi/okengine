/**
 * Canonical stack-env path — used to read compose credentials for driver
 * open options (not a separate Vault resolution layer).
 */

import { resolve } from "node:path";

/** Canonical relative path for stack credentials (project `.env.local`). */
export const COMPOSE_ENV_REL = ".env.local";

/**
 * Resolve the stack-env path (project `.env.local`).
 *
 * @param root - Project root
 */
export function resolveComposeEnvPath(root: string): {
  readonly path: string;
} {
  return { path: resolve(root, COMPOSE_ENV_REL) };
}
