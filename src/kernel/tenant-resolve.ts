/**
 * Per-request tenant identity resolution (three tiers).
 *
 * Tenant is an identity dimension like `fx.auth` — not a second authz system.
 */

import { isMember, type TenantStore } from "../auth/tenants.ts";
import {
  type ResolvedTenantAuth,
  type TenantAuthOptions,
  type TenantSource,
} from "../auth/tenant-config.ts";
import { fail, type FlowFailure } from "./errors.ts";
import type { FxAuthIdentity } from "./fx-auth-keys.ts";

export type { ResolvedTenantAuth, TenantAuthOptions, TenantSource };

/** Result of {@link resolveRequestTenant}. */
export interface RequestTenantResult {
  readonly id: string | null;
  readonly failure?: FlowFailure;
}

/** Options for {@link resolveRequestTenant}. */
export interface ResolveRequestTenantOptions {
  readonly config: ResolvedTenantAuth;
  readonly auth: FxAuthIdentity;
  readonly claimTenantId: string | null;
  readonly request?: Request;
  readonly store: TenantStore;
}

/**
 * Resolve tenant id for this request.
 *
 * Tier 1 (`claim`): signed `tid` / API-key `tenantId` — no membership query.
 * Tier 2 (`header` / `subdomain`): client-supplied — membership required.
 * Tier 3 (`resolve`): callback; membership required unless `authoritative`.
 *
 * @param options - Config + live identity + request
 */
export function resolveRequestTenant(options: ResolveRequestTenantOptions): RequestTenantResult {
  const { config, auth, claimTenantId, request, store } = options;
  const userId = auth.userId;
  const supplied = sourceValue(config, claimTenantId, request, auth);

  if (supplied === null || supplied === "") {
    if (config.required && userId) {
      return {
        id: null,
        failure: fail("Forbidden", { gate: "auth:tenants", reason: "tenant_required" }),
      };
    }
    return { id: null };
  }

  if (config.source === "claim") {
    return { id: supplied };
  }

  if (config.source === "resolve" && config.authoritative) {
    return { id: supplied };
  }

  if (!userId) {
    return {
      id: null,
      failure: fail("Unauthorized", {}),
    };
  }
  if (!isMember(store, supplied, userId)) {
    return {
      id: null,
      failure: fail("Forbidden", { gate: "auth:tenants", reason: "not_member" }),
    };
  }
  return { id: supplied };
}

function sourceValue(
  config: ResolvedTenantAuth,
  claimTenantId: string | null,
  request: Request | undefined,
  auth: FxAuthIdentity,
): string | null {
  if (config.source === "claim") {
    return claimTenantId;
  }
  // Internal / cron / fx.call have no HTTP request — keep the stamped claim.
  if (!request && (config.source === "header" || config.source === "subdomain")) {
    return claimTenantId;
  }
  if (config.source === "header") {
    const raw = request?.headers.get(config.header)?.trim();
    return raw && raw.length > 0 ? raw : null;
  }
  if (config.source === "subdomain") {
    return subdomainLabel(request);
  }
  if (config.source === "resolve" && config.resolve) {
    const out = config.resolve({
      auth: { userId: auth.userId, tenantId: claimTenantId },
      request,
      claimTenantId,
    });
    return out ?? null;
  }
  return claimTenantId;
}

/**
 * First Host label as a tenant slug/id (`acme.example.com` → `acme`).
 *
 * @param request - Incoming request
 */
export function subdomainLabel(request: Request | undefined): string | null {
  const host = request?.headers.get("host")?.split(":")[0]?.trim().toLowerCase();
  if (!host) return null;
  const parts = host.split(".");
  if (parts.length < 3) return null;
  const label = parts[0];
  if (!label || label === "www") return null;
  return label;
}
