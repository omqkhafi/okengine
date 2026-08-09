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
 */
export interface SeedDef {
  readonly essential?: SeedFns;
  readonly dev?: SeedFns;
  readonly prod?: SeedFns;
}

/** Env-selected category that runs alongside `essential` (or neither). */
export type SeedCategory = "dev" | "prod";

/**
 * Freeze a seed declaration for `src/db/seed/index.ts` default export.
 *
 * @param def - Essential / dev / prod function bags
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
