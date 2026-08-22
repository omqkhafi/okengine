/**
 * Tenant registry table names — kept off AUTH_TABLES so Store-only graphs
 * that already ship `oke_api_keys` do not also pin `oke_tenants`.
 */

/** Opt-in via `gate.auth.tenant`. */
export const AUTH_TENANT_TABLES = {
  tenants: "oke_tenants",
  tenantMembers: "oke_tenant_members",
  tenantRoles: "oke_tenant_roles",
} as const;
