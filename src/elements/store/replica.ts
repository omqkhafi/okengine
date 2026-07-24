/**
 * Automatic replica routing — derived from the effect set.
 *
 * Read-only flows (reads declared, no store writes) route to replicas.
 * No annotations required on the flow.
 */

import type { Effects } from "../../manifest/types.ts";
import type { SqlConnectOptions, SqlRole } from "../../drivers/types.ts";

/**
 * Whether a flow's effect set is store-read-only (eligible for replica routing).
 *
 * Emits / sends / asks do not force the primary — only `writes` do.
 *
 * @param effects - Declared or inferred effects
 */
export function isReadOnlyStoreFlow(effects: Effects): boolean {
  const writes = effects.writes?.length ?? 0;
  return writes === 0;
}

/**
 * Choose the SQL connection role for a flow from its effects.
 *
 * @param effects - Flow effects
 * @param hasReplicas - Whether replicas are configured
 */
export function sqlRoleForEffects(
  effects: Effects,
  hasReplicas: boolean,
): SqlRole {
  if (hasReplicas && isReadOnlyStoreFlow(effects)) return "replica";
  return "primary";
}

/** SQL binding with optional read replicas. */
export interface SqlBindingConfig {
  /** Primary connection options. */
  readonly primary: SqlConnectOptions;
  /** Read replicas (round-robin). */
  readonly replicas?: readonly SqlConnectOptions[];
}

/**
 * Resolve which connection options to use for a flow.
 *
 * @param config - Primary + replicas
 * @param effects - Flow effects
 * @param pickReplica - Index picker (defaults to 0)
 */
export function resolveSqlTarget(
  config: SqlBindingConfig,
  effects: Effects,
  pickReplica: (count: number) => number = () => 0,
): { readonly role: SqlRole; readonly options: SqlConnectOptions } {
  const replicas = config.replicas ?? [];
  const role = sqlRoleForEffects(effects, replicas.length > 0);
  if (role === "replica") {
    const idx = Math.abs(pickReplica(replicas.length)) % replicas.length;
    const options = replicas[idx]!;
    return { role: "replica", options: { ...options, role: "replica" } };
  }
  return {
    role: "primary",
    options: { ...config.primary, role: "primary" },
  };
}
