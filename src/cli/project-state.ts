/**
 * `.oke/state.json` — durable local project markers (survive across `oke dev`
 * sessions). Distinct from `.oke/dev.json` (live session lock) and
 * `.oke/console.secret` (Console session signing key).
 */

import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Relative path under the project root. */
export const PROJECT_STATE_REL = ".oke/state.json";

/**
 * Legacy one-shot seed marker (pre-state.json). Migrated on read then removed.
 * @deprecated Prefer {@link PROJECT_STATE_REL} `seededAt`.
 */
export const LEGACY_SEEDED_MARKER = ".oke/seeded";

/** Durable local project state (gitignored under `.oke/`). */
export type ProjectState = {
  /** ISO timestamp when prompted `oke db seed` last succeeded. */
  readonly seededAt?: string;
  /**
   * Seed identity (`defineSeed({ name })` or project folder).
   * A different name re-prompts — not a global "already seeded" flag.
   */
  readonly seed?: string;
};

/**
 * Absolute path to `.oke/state.json`.
 *
 * @param cwd - Project root
 */
export function projectStatePath(cwd: string): string {
  return resolve(cwd, PROJECT_STATE_REL);
}

/**
 * Parse and validate a state object from JSON.
 *
 * @param raw - Unknown JSON value
 */
export function parseProjectState(raw: unknown): ProjectState {
  if (raw === null || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const seededAt = o["seededAt"];
  const seed = o["seed"];
  return {
    ...(typeof seededAt === "string" && seededAt.trim().length > 0
      ? { seededAt: seededAt.trim() }
      : {}),
    ...(typeof seed === "string" && seed.trim().length > 0 ? { seed: seed.trim() } : {}),
  };
}

/**
 * Read project state, migrating a legacy `.oke/seeded` marker when present.
 *
 * @param cwd - Project root
 */
export async function readProjectState(cwd: string): Promise<ProjectState> {
  const path = projectStatePath(cwd);
  let state: ProjectState = {};
  if (await Bun.file(path).exists()) {
    try {
      state = parseProjectState(await Bun.file(path).json());
    } catch {
      state = {};
    }
  }

  if (state.seededAt) return state;

  const legacy = resolve(cwd, LEGACY_SEEDED_MARKER);
  if (!(await Bun.file(legacy).exists())) return state;

  let seededAt = new Date().toISOString();
  try {
    const text = (await Bun.file(legacy).text()).trim();
    if (text.length > 0) seededAt = text.split(/\r?\n/, 1)[0]!.trim() || seededAt;
  } catch {
    // keep generated timestamp
  }
  const migrated: ProjectState = { ...state, seededAt };
  await writeProjectState(cwd, migrated);
  try {
    await unlink(legacy);
  } catch {
    // best-effort
  }
  return migrated;
}

/**
 * Write project state (creates `.oke/` as needed).
 *
 * @param cwd - Project root
 * @param state - Full state payload
 */
export async function writeProjectState(cwd: string, state: ProjectState): Promise<void> {
  const path = projectStatePath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const body: Record<string, string> = {};
  if (state.seededAt) body.seededAt = state.seededAt;
  if (state.seed) body.seed = state.seed;
  await Bun.write(path, `${JSON.stringify(body, null, 2)}\n`);
}

/**
 * Whether prompted seed already completed for this seed identity.
 *
 * @param cwd - Project root
 * @param seed - Current {@link SeedDef.name} / folder id; a mismatch re-asks
 */
export async function isProjectSeeded(cwd: string, seed?: string): Promise<boolean> {
  const state = await readProjectState(cwd);
  if (typeof state.seededAt !== "string" || state.seededAt.length === 0) return false;
  if (seed === undefined) return true;
  return state.seed === seed;
}

/**
 * Record a successful prompted seed (ISO timestamp + identity).
 *
 * @param cwd - Project root
 * @param options - Seed id and optional timestamp
 */
export async function markProjectSeeded(
  cwd: string,
  options: { readonly seed?: string; readonly at?: string } = {},
): Promise<void> {
  const prev = await readProjectState(cwd);
  await writeProjectState(cwd, {
    ...prev,
    seededAt: options.at ?? new Date().toISOString(),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
  });
}
