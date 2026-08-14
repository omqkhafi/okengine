/**
 * Query-console "view as Gate" choices — Operator, public, user, or policy.
 *
 * Gates are OKE authorization, not Postgres `TO` roles. Selecting one sets
 * `oke.gate` on postgres / pglite so RLS policies can read
 * `current_setting('oke.gate', true)`.
 */

import type { RlsCatalogGate, RlsGateCatalog } from "./rls-gate-catalog.ts";

/** Card in the query-console Gate picker. */
export type QueryGateMode = "operator" | "public" | "as";

/** One row in the query-console Gate menu. */
export type QueryGateChoice = {
  /** `operator` = default (bypasses RLS). Otherwise a Gate name. */
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly kind: "operator" | "public" | "policy";
};

/** Policy Gate listed under the As card. */
export type QueryGatePolicyChoice = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
};

/** App identity listed under the As card. */
export type QueryGateUserChoice = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  /** Policy Gate applied when this user is selected. */
  readonly gate: string;
};

/** Identity slice used to build As-card user rows. */
export type QueryGateIdentity = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly status: string;
  readonly scopes: readonly string[];
};

/**
 * Card selected for the current `asGate` value.
 *
 * @param asGate - Selected gate name, or null for Operator
 */
export function queryGateMode(asGate: string | null): QueryGateMode {
  if (asGate === null || asGate.length === 0) return "operator";
  if (asGate === "public") return "public";
  return "as";
}

/**
 * Build the Gate menu: Operator, public, then policy gates.
 *
 * @param catalog - Manifest + panel catalog
 */
export function queryGateChoices(catalog: RlsGateCatalog): readonly QueryGateChoice[] {
  const publicGate = catalog.gates.find((gate) => gate.kind === "public");
  const policies = catalog.gates.filter((gate) => gate.kind === "policy");
  return [
    {
      id: "operator",
      label: "Operator",
      detail: "Full admin access. Bypasses Row Level Security.",
      kind: "operator",
    },
    {
      id: "public",
      label: "public",
      detail: publicGate?.description ?? "Intentionally unauthenticated.",
      kind: "public",
    },
    ...policies.map((gate) => ({
      id: gate.name,
      label: gate.name,
      detail: gateChoiceDetail(gate),
      kind: "policy" as const,
    })),
  ];
}

/**
 * Policy gates for the As card (excludes Operator and public).
 *
 * @param catalog - Manifest + panel catalog
 */
export function queryGatePolicyChoices(catalog: RlsGateCatalog): readonly QueryGatePolicyChoice[] {
  return catalog.gates
    .filter((gate) => gate.kind === "policy")
    .map((gate) => ({
      id: gate.name,
      label: gate.name,
      detail: gateChoiceDetail(gate),
    }));
}

/**
 * Identities that map onto a declared policy Gate via scope or role.
 *
 * @param identities - Invoke-as identities
 * @param catalog - Manifest + panel catalog
 */
export function queryGateUserChoices(
  identities: readonly QueryGateIdentity[],
  catalog: RlsGateCatalog,
): readonly QueryGateUserChoice[] {
  const out: QueryGateUserChoice[] = [];
  for (const identity of identities) {
    if (identity.status !== "active") continue;
    const gate = policyGateForScopes(identity.scopes, catalog);
    if (gate === null) continue;
    out.push({
      id: identity.id,
      label: identity.name || identity.email,
      detail: identity.email,
      gate,
    });
  }
  return out;
}

/**
 * First policy Gate implied by identity scopes (name, then role).
 *
 * @param scopes - Identity scopes
 * @param catalog - Manifest + panel catalog
 */
export function policyGateForScopes(
  scopes: readonly string[],
  catalog: RlsGateCatalog,
): string | null {
  const policies = catalog.gates.filter((gate) => gate.kind === "policy");
  for (const scope of scopes) {
    if (policies.some((gate) => gate.name === scope)) return scope;
  }
  for (const scope of scopes) {
    const viaRole = policies.find((gate) => gate.roles.includes(scope));
    if (viaRole) return viaRole.name;
  }
  return null;
}

/**
 * Filter As-card rows by a case-insensitive query.
 *
 * @param rows - Policy or user choices
 * @param query - Search text
 * @param extra - Extra fields per row (user email already in `detail`)
 */
export function filterQueryGateAsChoices<
  T extends { readonly id: string; readonly label: string; readonly detail: string },
>(
  rows: readonly T[],
  query: string,
  extra: (row: T) => readonly string[] = () => [],
): readonly T[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return rows;
  return rows.filter((row) =>
    [row.id, row.label, row.detail, ...extra(row)].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

/**
 * Toolbar label for the current Gate pick.
 *
 * @param asGate - Selected gate name, or null for Operator
 */
export function queryGateToolbarLabel(asGate: string | null): string {
  return asGate && asGate.length > 0 ? `Gate · ${asGate}` : "Gate";
}

function gateChoiceDetail(gate: RlsCatalogGate): string {
  if (gate.description) return gate.description;
  if (gate.roles.length > 0) return `Roles ${gate.roles.join(", ")}`;
  if (gate.scopes.length > 0) return gate.scopes.join(" · ");
  return "Policy gate";
}
