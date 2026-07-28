/**
 * Persisted `oke dev` run mode — `local` vs `docker`.
 */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Saved / selectable `oke dev` infrastructure mode. */
export type DevMode = "local" | "docker";

/** Relative path under the project root. */
export const DEV_MODE_RELATIVE_PATH = ".oke/mode";

/**
 * Absolute path to the mode preference file.
 *
 * @param cwd - Project root
 */
export function devModePath(cwd: string): string {
  return resolve(cwd, DEV_MODE_RELATIVE_PATH);
}

/**
 * Parse a raw mode string.
 *
 * @param raw - File contents or CLI arg
 */
export function parseDevMode(raw: string | undefined | null): DevMode | null {
  if (raw === undefined || raw === null) return null;
  const value = raw.trim().toLowerCase();
  if (value === "local" || value === "docker") return value;
  return null;
}

/**
 * Read the saved mode from `.oke/mode`, or `null` when unset / invalid.
 *
 * @param cwd - Project root
 */
export async function readDevMode(cwd: string): Promise<DevMode | null> {
  const path = devModePath(cwd);
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    return parseDevMode(await file.text());
  } catch {
    return null;
  }
}

/**
 * Persist the preferred mode for future `oke dev` invocations.
 *
 * @param cwd - Project root
 * @param mode - Mode to save
 */
export async function writeDevMode(cwd: string, mode: DevMode): Promise<void> {
  const path = devModePath(cwd);
  await mkdir(join(cwd, ".oke"), { recursive: true });
  await Bun.write(path, `${mode}\n`);
}

/**
 * Whether `oke dev` should open the one-time mode prompt.
 *
 * Mirrors create-oke: never prompt when stdin is not a TTY.
 *
 * @param options - Preference + TTY + explicit flag
 */
export function shouldAskDevMode(options: {
  readonly saved: DevMode | null;
  readonly explicit: boolean;
  readonly stdinIsTTY: boolean | undefined;
}): boolean {
  if (options.explicit) return false;
  if (options.saved !== null) return false;
  return Boolean(options.stdinIsTTY);
}
