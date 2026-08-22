/**
 * Tenant schema helpers — lazy chunk off Store-only `oke()` graphs.
 *
 * `store.schema.policy.tenant` / `store.schema.unscoped` stay on the public
 * API via getters; this module is loaded on first access.
 */

import {
  schemaPolicy,
  helperPolicyName,
  policyPredicates,
  type SchemaPolicyDecl,
  type SchemaPolicyOptions,
  type SchemaTenantScopedDecl,
} from "./schema-decl.ts";

/**
 * Tenant-column policy — `tenant_id = oke.tenant()`.
 *
 * @param column - SQL / JS column name
 * @param options - Command (default `all`)
 */
export function tenant(
  column: string,
  options: Pick<SchemaPolicyOptions, "for" | "as" | "to"> = {},
): SchemaPolicyDecl {
  const command = options.for ?? "all";
  return schemaPolicy(helperPolicyName("tenant", column, command), {
    ...options,
    for: command,
    ...policyPredicates(command, `${column} = oke.tenant()`),
  });
}

/**
 * Mark a table as globally shared (`tenantScoped: false`).
 * Required when `gate.auth.tenant` is on and the table has no tenant policy.
 */
export function unscoped(): SchemaTenantScopedDecl {
  return { kind: "schema-tenant-scoped", tenantScoped: false };
}
