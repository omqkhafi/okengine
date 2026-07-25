/**
 * Bidirectional list grouping — principals or flows (console §9.7).
 *
 * The roles × permissions matrix is refused as an entry point.
 */

import type {
  FlowGatesRecord,
  GatesListGroup,
  PrincipalRecord,
} from "./types.ts";

/**
 * Group principals by kind for the from-principal inquiry.
 *
 * @param principals - Principal rows (violations excluded upstream)
 * @param query - Optional filter
 */
export function groupPrincipals(
  principals: readonly PrincipalRecord[],
  query = "",
): readonly GatesListGroup[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? principals.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          (p.email?.toLowerCase().includes(q) ?? false) ||
          p.scopes.some((s) => s.toLowerCase().includes(q)),
      )
    : principals;

  const order: Array<"role" | "key" | "user"> = ["role", "key", "user"];
  const labels = {
    role: "Roles",
    key: "API keys",
    user: "Users",
  } as const;

  return order
    .map((kind) => ({
      id: kind,
      label: labels[kind],
      items: filtered
        .filter((p) => p.kind === kind)
        .map((p) => ({
          id: `${p.kind}:${p.id}`,
          label: p.name,
          meta:
            kind === "role"
              ? `${p.scopes.length} scopes · ${p.memberCount ?? 0} members`
              : `${p.scopes.length} scopes`,
          flag: p.plane === "operator" ? "operator" : undefined,
        })),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * Group flows by plane for the from-flow inquiry.
 *
 * @param flows - Flow rows
 * @param query - Optional filter
 */
export function groupFlows(
  flows: readonly FlowGatesRecord[],
  query = "",
): readonly GatesListGroup[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? flows.filter(
        (f) =>
          f.flowId.toLowerCase().includes(q) ||
          f.gates.some((g) => g.toLowerCase().includes(q)),
      )
    : flows;

  const planes: Array<"user" | "operator"> = ["user", "operator"];
  const labels = {
    user: "User plane",
    operator: "Operator plane",
  } as const;

  return planes
    .map((plane) => ({
      id: plane,
      label: labels[plane],
      items: filtered
        .filter((f) => f.plane === plane)
        .map((f) => ({
          id: f.flowId,
          label: f.flowId,
          meta:
            f.gates.length === 0
              ? "ungated"
              : f.gates.join(" → "),
          flag: f.unguarded ? "unguarded" : undefined,
        })),
    }))
    .filter((g) => g.items.length > 0);
}
