/**
 * Resolve the active SQL env for schema tooling (`oke db`, `oke dev`
 * one-shot sync). Docker-first: `oke dev` always uses `dev`.
 */

import type { ConfigEnv } from "../config/index.ts";

/** Options for {@link resolveDevSqlEnv}. */
export interface ResolveDevSqlEnvOptions {
  /**
   * Session override — `true` means compose infra is up. Ignored for env
   * selection (always `dev` unless `options.env` is set); kept for call-site
   * compatibility.
   */
  readonly docker?: boolean;
  /**
   * Explicit env override (e.g. `oke db --env test`). Wins over the default.
   */
  readonly env?: ConfigEnv;
}

/**
 * Resolve the SQL {@link ConfigEnv} for tooling without prompting.
 *
 * Order:
 * 1. Explicit `options.env` (CLI flag)
 * 2. Default `dev` (Docker-first local development)
 *
 * @param _cwd - Project root (unused; kept for call-site compatibility)
 * @param options - Session / CLI overrides
 */
export async function resolveDevSqlEnv(
  _cwd: string,
  options: ResolveDevSqlEnvOptions = {},
): Promise<ConfigEnv> {
  void _cwd;
  void options.docker;
  if (options.env !== undefined) return options.env;
  return "dev";
}
