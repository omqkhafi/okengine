/**
 * One Gate → RLS identity bag for Console, Call API, and `fx.store`.
 */

import type { Manifest } from "../../manifest/types.ts";
import type { RlsIdentity } from "../../drivers/pg-rls.ts";

export type { RlsIdentity };

/** Seeded Console identity used by invoke-as / Gate picker. */
export type RlsIdentityRow = {
  readonly id: string;
  readonly scopes: readonly string[];
  readonly status?: string;
};

/** Input to {@link resolveRlsIdentity}. */
export type ResolveRlsIdentityInput = {
  readonly asGate?: string | null;
  readonly asUserId?: string | null;
  readonly bypass?: boolean;
  readonly identities?: readonly RlsIdentityRow[];
  readonly manifest?: Manifest | null;
};

/**
 * Console / Call API bag. Operator and `bypass` return `null` (no stamp).
 *
 * @param input - Picker + Manifest
 */
export function resolveRlsIdentity(input: ResolveRlsIdentityInput): RlsIdentity | null {
  if (input.bypass === true) return null;
  const asGate = input.asGate?.trim() || null;
  const asUserId = input.asUserId?.trim() || null;
  if (!asGate && !asUserId) return null;

  if (asUserId) {
    const identity = (input.identities ?? []).find(
      (row) => row.id === asUserId && row.status !== "disabled",
    );
    if (!identity) return null;
    const gate = asGate ?? policyGateForScopes(identity.scopes, input.manifest);
    if (!gate) return null;
    return { gate, userId: identity.id, scopes: [...identity.scopes] };
  }

  if (!asGate) return null;
  if (asGate === "public") {
    return { gate: "public", userId: "", scopes: [] };
  }

  const declared = input.manifest?.gates?.[asGate];
  if (!declared || declared.kind === "rate" || asGate.startsWith("rate:")) return null;
  const scopes = declared.scopes && declared.scopes.length > 0 ? declared.scopes : [asGate];
  return { gate: asGate, userId: "", scopes: [...scopes] };
}

/**
 * Live HTTP / resource-mount bag after Gate passes.
 *
 * @param input - `fx.auth` + trigger gate names
 */
export function rlsIdentityFromAuth(input: {
  readonly userId: string | null;
  readonly scopes: ReadonlySet<string> | readonly string[];
  readonly gateNames: readonly string[];
  readonly bypass?: boolean;
  readonly operator?: boolean;
  /** When set (tenancy on), stamp `oke.tenant` — empty string if unresolved. */
  readonly tenantId?: string | null;
}): RlsIdentity | null {
  if (input.bypass === true || input.operator === true) return null;
  const gate = firstPolicyOrPublic(input.gateNames);
  if (!gate) return null;
  const scopes = Array.isArray(input.scopes) ? input.scopes : [...input.scopes];
  return {
    gate,
    userId: input.userId ?? "",
    scopes,
    ...(input.tenantId !== undefined ? { tenantId: input.tenantId ?? "" } : {}),
  };
}

/**
 * First policy/public name (rate ids skipped).
 *
 * @param names - Trigger gate names
 */
export function firstPolicyOrPublic(names: readonly string[]): string | null {
  for (const name of names) {
    if (name.startsWith("rate:")) continue;
    if (name.length > 0) return name;
  }
  return null;
}

/**
 * First Manifest policy implied by scopes (name, then declared roles).
 *
 * @param scopes - Identity scopes
 * @param manifest - Current Manifest
 */
export function policyGateForScopes(
  scopes: readonly string[],
  manifest: Manifest | null | undefined,
): string | null {
  const gates = manifest?.gates ?? {};
  for (const scope of scopes) {
    const gate = gates[scope];
    if (gate && gate.kind !== "rate") return scope;
  }
  for (const scope of scopes) {
    for (const [name, gate] of Object.entries(gates)) {
      if (gate.kind === "rate") continue;
      if ((gate.roles ?? []).includes(scope)) return name;
    }
  }
  return null;
}
