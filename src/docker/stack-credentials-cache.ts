/**
 * Persist compose credentials by stack instance id under `~/.oke/stacks/`.
 *
 * `.env.local` is the project copy. Recreating the folder (create-oke, delete)
 * generates new passwords while the Docker volume still has the first init
 * password — `password authentication failed for user "oke"`. The cache keeps
 * the password that matches `oke-dev-<id>` volumes across project wipes.
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ServiceCredentials } from "./types.ts";

/** Credential keys written into the per-stack cache file. */
const CACHE_ENV_KEYS = [
  "OKE_STORE_SQL_USER",
  "OKE_STORE_SQL_PASSWORD",
  "OKE_STORE_SQL_DB",
  "OKE_STORE_KV_USER",
  "OKE_STORE_KV_PASSWORD",
  "OKE_STORE_KV_DB",
  "OKE_STORE_FILES_USER",
  "OKE_STORE_FILES_PASSWORD",
  "OKE_STORE_FILES_DB",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "OKE_STORE_INDEX_KEY",
] as const;

/**
 * Path of the credential cache for a 6-hex stack instance id.
 *
 * @param instanceId - {@link import("./stack-id.ts").stackInstanceId}
 * @param home - Home directory (injectable in tests)
 */
export function stackCredentialsCachePath(instanceId: string, home: string = homedir()): string {
  return join(home, ".oke", "stacks", `${instanceId}.env`);
}

/**
 * Merge project `.env.local` credentials with the home-dir cache.
 * Per-role values in `local` win; cache fills roles the project file lacks.
 *
 * @param local - Parsed from `.env.local`
 * @param cached - Parsed from `~/.oke/stacks/<id>.env`
 */
export function mergeStackCredentials(
  local: Readonly<Record<string, ServiceCredentials>> | undefined,
  cached: Readonly<Record<string, ServiceCredentials>> | undefined,
): Record<string, ServiceCredentials> | undefined {
  if (!local && !cached) return undefined;
  if (!local) return cached ? { ...cached } : undefined;
  if (!cached) return { ...local };
  return { ...cached, ...local };
}

/**
 * Raw dotenv body of the credential cache, or `undefined` when missing.
 *
 * @param instanceId - 6-hex stack id
 * @param home - Home directory (injectable in tests)
 */
export async function readStackCredentialsCacheText(
  instanceId: string,
  home: string = homedir(),
): Promise<string | undefined> {
  const path = stackCredentialsCachePath(instanceId, home);
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  const text = await file.text();
  return text.trim().length > 0 ? text : undefined;
}

/**
 * Write password keys from derived stack env into the home-dir cache.
 *
 * @param instanceId - 6-hex stack id
 * @param stackEnv - Derived compose env (includes `OKE_*_PASSWORD`)
 * @param home - Home directory (injectable in tests). Skipped when `BUN_TEST`
 *   is set and `home` is the real homedir, so unit tests do not write `~/.oke`.
 */
export async function writeStackCredentialsCache(
  instanceId: string,
  stackEnv: Readonly<Record<string, string>>,
  home: string = homedir(),
): Promise<void> {
  if (process.env.BUN_TEST && home === homedir()) return;
  const lines: string[] = ["# oke stack credentials — do not commit", ""];
  for (const key of CACHE_ENV_KEYS) {
    const value = stackEnv[key];
    if (value) lines.push(`${key}=${value}`);
  }
  if (lines.length <= 2) return;
  const path = stackCredentialsCachePath(instanceId, home);
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, `${lines.join("\n")}\n`);
}

/**
 * Drop the cache after `oke docker clean` tears down that stack's volumes.
 *
 * @param instanceId - 6-hex stack id
 * @param home - Home directory (injectable in tests)
 */
export async function clearStackCredentialsCache(
  instanceId: string,
  home: string = homedir(),
): Promise<void> {
  const path = stackCredentialsCachePath(instanceId, home);
  try {
    await Bun.file(path).unlink();
  } catch {
    // Missing cache is the desired end state.
  }
}

/**
 * 6-hex id from `oke-dev-<id>`, or `undefined` when the name is not ours.
 *
 * @param project - Compose project name
 */
export function instanceIdFromComposeProject(project: string): string | undefined {
  const m = /^oke-dev-([0-9a-f]{6})$/.exec(project);
  return m?.[1];
}
