/**
 * Tenant identity + role-scope union — lazy chunk.
 *
 * A static import from {@link ./pipeline.ts} would pin tenant-resolve and
 * the tenant store (and `isApplicationScope`) on every `oke()` graph,
 * including Store-only apps that never enable `gate.auth.tenant`.
 */

import { tenantScopesForMember } from "../auth/tenants.ts";
import type { FlowFailure } from "./errors.ts";
import type { PipelineDeps } from "./pipeline.ts";
import type { InvocationContext } from "./hooks.ts";
import { resolveRequestTenant } from "./tenant-resolve.ts";

/**
 * Resolve tenant id and conditionally union tenant-role scopes.
 *
 * @param deps - Pipeline deps (`tenant` must be set)
 * @param ctx - Invocation
 */
export function applyPipelineTenant(
  deps: PipelineDeps,
  ctx: InvocationContext,
): FlowFailure | undefined {
  const tenant = deps.tenant;
  if (!tenant) return undefined;
  const auth = deps.principals.auth;
  auth.sessionScopes ??= new Set(auth.scopes);
  const claimTenantId = deps.principals.tenant.id;
  const result = resolveRequestTenant({
    config: tenant.config,
    auth: deps.principals.auth,
    claimTenantId,
    request: ctx.request,
    store: tenant.store,
  });
  if (result.failure) return result.failure;
  deps.principals.tenant.id = result.id;
  const userId = deps.principals.auth.userId;
  if (result.id && userId && tenant.flowTenantScoped && tenant.flowPlane !== "operator") {
    for (const scope of tenantScopesForMember(tenant.store, result.id, userId)) {
      deps.principals.auth.scopes.add(scope);
    }
  }
  return undefined;
}

/** Short name so the Store-only `oke()` graph does not spell {@link applyPipelineTenant}. */
export { applyPipelineTenant as run };
