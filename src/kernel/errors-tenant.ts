/**
 * OKE1015–1017 — kept off the Store-only `oke()` graph.
 *
 * Tenant KV/vault and membership failures. Loaded via computed
 * `import.meta.require` from {@link throwOke} / {@link lookupOkeError}.
 */

import type { OkeErrorDefinition } from "./errors.ts";

/** Tenant-scoped op ran with no resolved `fx.tenant.id`. */
export const TENANT_REQUIRED: OkeErrorDefinition = {
  code: 1015,
  cause: "This operation needs a tenant, but none is resolved for this request.",
  fix: "Call fx.auth.switchTenant(id), send a signed tid claim, or pass the tenant header.",
};

/** Client-supplied tenant id is not a real membership. */
export const TENANT_NOT_MEMBER: OkeErrorDefinition = {
  code: 1016,
  cause: 'The caller is not a member of tenant "{tenant}".',
  fix: "Pick a tenant from fx.auth.listTenants() or add the user as a member.",
};

/** Tenant role mapped an invented or operator-plane scope. */
export const TENANT_UNKNOWN_SCOPE: OkeErrorDefinition = {
  code: 1017,
  cause: 'Tenant role scope "{scope}" is not a declared application scope.',
  fix: "Use a name from this app's Manifest catalog (never console:*).",
};
