/**
 * Database seed declarations — `defineSeed({ essential, dev, prod })`.
 *
 * Seed never runs at boot; only via `oke db seed`.
 */

import type { ConfigEnv } from "../../config/index.ts";
import type { Fx } from "../../kernel/fx.ts";

/** One seed function — receives a privileged `fx` with store access. */
export type SeedFn = (fx: Fx) => Promise<void>;

/** Single function or ordered array (array order is execution order). */
export type SeedFns = SeedFn | readonly SeedFn[];

/**
 * Seed categories for {@link defineSeed}.
 *
 * - `essential` — every environment, always
 * - `dev` — `dev` ConfigEnv only (Docker Compose laptop)
 * - `prod` — `prod` only
 *
 * `name` / `description` identify this app's seed (template or example) —
 * the CLI prompt and `.oke/state.json` key off `name`, never a global flag.
 */
export interface SeedDef {
  /** App / template / example id (`keel`, `notes`). */
  readonly name?: string;
  /** One-line label for the `oke dev` seed prompt. */
  readonly description?: string;
  readonly essential?: SeedFns;
  readonly dev?: SeedFns;
  readonly prod?: SeedFns;
}

/** Resolved seed identity for CLI prompt + project state. */
export interface SeedIdentity {
  readonly name: string;
  readonly description?: string;
}

/**
 * Identity for this seed module: declared `name`, else the project folder.
 *
 * @param def - Seed declaration (may omit name)
 * @param cwd - Project root
 */
export function resolveSeedIdentity(
  def: Pick<SeedDef, "name" | "description"> | undefined,
  cwd: string,
): SeedIdentity {
  const declared = def?.name?.trim();
  const fromDir = cwd
    .replace(/[/\\]+$/, "")
    .split(/[/\\]/)
    .pop()
    ?.trim();
  const name = (declared && declared.length > 0 ? declared : fromDir) || "app";
  const description = def?.description?.trim();
  return description && description.length > 0 ? { name, description } : { name };
}

/**
 * Confirm copy for `oke dev` / `oke db seed` — names this app's seed.
 *
 * @param identity - Resolved {@link SeedIdentity}
 */
export function seedPromptMessage(identity: SeedIdentity): string {
  return identity.description
    ? `Seed ${identity.name} (${identity.description})?`
    : `Seed ${identity.name}?`;
}

/** Env-selected category that runs alongside `essential` (or neither). */
export type SeedCategory = "dev" | "prod";

/**
 * Freeze a seed declaration for `src/db/seed/index.ts` default export.
 *
 * @param def - Name / description plus essential / dev / prod function bags
 */
export function defineSeed(def: SeedDef): SeedDef {
  return def;
}

/**
 * Normalize a seed key to an ordered function list.
 *
 * @param fns - Single function, array, or omitted
 */
export function normalizeSeedFns(fns?: SeedFns): SeedFn[] {
  if (fns === undefined) return [];
  if (typeof fns === "function") return [fns];
  return [...fns];
}

/**
 * Which optional category runs for `env` (single source of truth).
 *
 * | env  | category |
 * | ---- | -------- |
 * | dev  | dev      |
 * | test | (none)   |
 * | prod | prod     |
 *
 * @param env - Resolved {@link ConfigEnv}
 */
export function resolveSeedCategory(env: ConfigEnv): SeedCategory | null {
  if (env === "dev") return "dev";
  if (env === "prod") return "prod";
  return null;
}
