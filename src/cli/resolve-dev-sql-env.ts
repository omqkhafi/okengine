/**
 * Resolve the active SQL env for schema tooling (`oke db`, `oke mode`,
 * `oke dev` one-shot sync) from session overrides and the saved dev mode.
 */

import type { ConfigEnv } from "../config/index.ts";
import { readDevMode } from "./dev-mode.ts";

/** Options for {@link resolveDevSqlEnv}. */
export interface ResolveDevSqlEnvOptions {
  /**
   * Session override — `true` means docker (e.g. `OKE_DOCKER=1` or
   * `oke dev --docker`). `false` means local. `undefined` → auto-resolve.
   */
  readonly docker?: boolean;
  /**
   * Explicit env override (e.g. `oke db --env docker`). Wins over `.oke/mode`.
   */
  readonly env?: ConfigEnv;
}

/**
 * Resolve the SQL env (`local` | `docker` for dev tooling) without prompting.
 *
 * Order:
 * 1. Explicit `options.env` (CLI flag)
 * 2. Session docker flag (`options.docker`)
 * 3. `.oke/mode` persisted preference
 * 4. Default `local`
 *
 * @param cwd - Project root
 * @param options - Session / CLI overrides
 */
export async function resolveDevSqlEnv(
  cwd: string,
  options: ResolveDevSqlEnvOptions = {},
): Promise<ConfigEnv> {
  if (options.env !== undefined) return options.env;
  if (options.docker !== undefined) return options.docker ? "docker" : "local";
  const saved = await readDevMode(cwd);
  return saved ?? "local";
}
