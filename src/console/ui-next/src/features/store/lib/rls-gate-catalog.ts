/**
 * Create-policy Advanced Gate catalog — `gate.public`, `gate.policy`, `gate.scope`.
 *
 * Module:Action and Access roles are not Gate kinds. Picks stay on Gate —
 * they are not Postgres `TO` roles.
 */

import { deriveModuleActions } from "../../../../../../elements/gate/permissions.ts";
import type { Manifest } from "../../../../../../manifest/types.ts";
import {
  rlsGateActionsForMode,
  rlsGateModeFromCommand,
  type SqlPolicyCommand,
} from "./rls-policy.ts";

/** Empty Manifest so builtins still appear when the snapshot is missing. */
const EMPTY_MANIFEST: Manifest = { oke: "1.0", app: "" };

/** Reserved `gate.public` sentinel. */
export const RLS_GATE_PUBLIC = "public";

/** Store SQL read pair. */
export const RLS_STORE_READ = "store.sql:read";

/** Store SQL write pair. */
export const RLS_STORE_WRITE = "store.sql:write";

/** How a catalog Gate was declared. */
export type RlsGateVariant = "public" | "policy" | "scope";

/** One declared Gate in the Advanced picker (rate gates omitted). */
export type RlsCatalogGate = {
  readonly name: string;
  readonly kind: "policy" | "public";
  /** `gate.public` · `gate.policy` · `gate.scope`. */
  readonly variant: RlsGateVariant;
  readonly description?: string;
  readonly scopes: readonly string[];
  readonly roles: readonly string[];
};

/** Advanced Gate catalog for the create-policy sheet. */
export type RlsGateCatalog = {
  readonly gates: readonly RlsCatalogGate[];
  readonly actions: readonly string[];
  readonly roles: readonly string[];
};

/** Operator picks that pair this policy with Gate / Access. */
export type RlsGateSelection = {
  readonly gates: readonly string[];
  readonly actions: readonly string[];
  readonly roles: readonly string[];
};

/**
 * Build the Advanced Gate catalog from a Manifest snapshot.
 *
 * @param manifest - Current Manifest, or null
 */
export function rlsGateCatalog(manifest: Manifest | null): RlsGateCatalog {
  const source = manifest ?? EMPTY_MANIFEST;
  const gates: RlsCatalogGate[] = [
    {
      name: RLS_GATE_PUBLIC,
      kind: "public",
      variant: "public",
      description: "Intentionally unauthenticated",
      scopes: [],
      roles: [],
    },
  ];

  for (const [name, gate] of Object.entries(source.gates ?? {})) {
    if (gate.kind === "rate" || name.startsWith("rate:")) continue;
    const scopes = gate.scopes ?? [];
    const roles = gate.roles ?? [];
    if (name === RLS_GATE_PUBLIC) {
      const existing = gates[0];
      if (existing) {
        gates[0] = {
          ...existing,
          description: gate.description ?? existing.description,
          scopes,
          roles,
        };
      }
      continue;
    }
    gates.push({
      name,
      kind: "policy",
      variant: rlsGateVariant({ name, kind: "policy", scopes }),
      ...(gate.description !== undefined ? { description: gate.description } : {}),
      scopes,
      roles,
    });
  }

  const roles = uniqueSorted(gates.flatMap((gate) => [...gate.roles]));
  return {
    gates,
    actions: deriveModuleActions(source),
    roles,
  };
}

/** Live Gates panel slice used to enrich the Manifest catalog. */
export type RlsGatePanelSlice = {
  readonly moduleActions?: readonly string[];
  readonly principals?: readonly {
    readonly kind: string;
    readonly name: string;
  }[];
};

/**
 * Merge Access roles and Module:Action pairs from `GET /console/gates`.
 *
 * @param catalog - Manifest catalog
 * @param panel - Gates panel slice, or null
 */
export function mergeRlsGateCatalog(
  catalog: RlsGateCatalog,
  panel: RlsGatePanelSlice | null,
): RlsGateCatalog {
  if (panel === null) return catalog;
  const roles = uniqueSorted([
    ...catalog.roles,
    ...(panel.principals ?? [])
      .filter((principal) => principal.kind === "role")
      .map((principal) => principal.name),
  ]);
  return {
    ...catalog,
    actions: uniqueSorted([...(panel.moduleActions ?? []), ...catalog.actions]),
    roles,
  };
}

/**
 * Filter catalog rows by a case-insensitive query.
 *
 * @param catalog - Full catalog
 * @param query - Search text
 */
export function filterRlsGateCatalog(catalog: RlsGateCatalog, query: string): RlsGateCatalog {
  const needle = query.trim().toLowerCase();
  if (needle === "") return catalog;
  return {
    gates: catalog.gates.filter((gate) =>
      matchesQuery(
        needle,
        gate.name,
        gate.kind,
        gate.variant,
        gate.description,
        ...gate.scopes,
        ...gate.roles,
      ),
    ),
    actions: catalog.actions.filter((action) => matchesQuery(needle, action)),
    roles: catalog.roles.filter((role) => matchesQuery(needle, role)),
  };
}

/**
 * SQL command implied by selected Module:Action pairs.
 *
 * @param actions - Selected pairs
 * @param previous - Current command
 */
export function rlsCommandFromActions(
  actions: readonly string[],
  previous: SqlPolicyCommand,
): SqlPolicyCommand {
  const read = actions.includes(RLS_STORE_READ);
  const write = actions.includes(RLS_STORE_WRITE);
  if (read && write) return "ALL";
  if (read) return "SELECT";
  if (write) {
    if (previous === "INSERT" || previous === "UPDATE" || previous === "DELETE") return previous;
    return "INSERT";
  }
  return previous;
}

/**
 * Keep custom pairs and align `store.sql:*` with a SQL command.
 *
 * @param actions - Current pairs
 * @param command - Policy `FOR` command
 */
export function rlsSyncActionsForCommand(
  actions: readonly string[],
  command: SqlPolicyCommand,
): string[] {
  const extras = actions.filter(
    (action) => action !== RLS_STORE_READ && action !== RLS_STORE_WRITE,
  );
  return uniqueSorted([...rlsGateActionsForMode(rlsGateModeFromCommand(command)), ...extras]);
}

/**
 * True when the selection is more than the simple Read / Write / Both posture.
 *
 * @param selection - Current picks
 * @param command - Policy `FOR` command
 */
export function rlsGateSelectionIsCustom(
  selection: RlsGateSelection,
  _command: SqlPolicyCommand,
): boolean {
  return selection.gates.length > 0;
}

/**
 * Compact pairing line for the Gate row.
 *
 * @param selection - Current picks
 */
export function rlsGateSelectionSummary(selection: RlsGateSelection): string {
  return uniqueSorted(selection.gates).join(" · ");
}

/**
 * Count of picks beyond the simple store.sql posture.
 *
 * @param selection - Current picks
 */
export function rlsGateSelectionExtraCount(selection: RlsGateSelection): number {
  return selection.gates.length;
}

function matchesQuery(needle: string, ...fields: Array<string | undefined>): boolean {
  return fields.some((field) => field !== undefined && field.toLowerCase().includes(needle));
}

/**
 * `gate.public` · `gate.policy` · `gate.scope` from Manifest fields.
 *
 * @param gate - Catalog row (or a name/kind/scopes slice)
 */
export function rlsGateVariant(gate: {
  readonly name: string;
  readonly kind: "policy" | "public";
  readonly scopes: readonly string[];
}): RlsGateVariant {
  if (gate.kind === "public" || gate.name === RLS_GATE_PUBLIC) return "public";
  if (gate.scopes.length > 0) return "scope";
  return "policy";
}

/**
 * `gate.public` and `gate.policy` rows (ABAC).
 *
 * @param catalog - Full catalog
 */
export function rlsCatalogPolicies(catalog: RlsGateCatalog): readonly RlsCatalogGate[] {
  return catalog.gates.filter((gate) => gate.variant !== "scope");
}

/**
 * `gate.scope` rows (`auth.scopes.has(name)`).
 *
 * @param catalog - Full catalog
 */
export function rlsCatalogScopes(catalog: RlsGateCatalog): readonly RlsCatalogGate[] {
  return catalog.gates.filter((gate) => gate.variant === "scope");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
