/**
 * Format effective-permission provenance (inverse of Gates simulator).
 */

import type { AccessEffectiveResponse } from "./types.ts";

/** One display line for a scope + sources. */
export interface ProvenanceLine {
  readonly scope: string;
  readonly sources: string;
}

/**
 * Format provenance lines for the effective-permissions view.
 *
 * @param effective - Server response
 */
export function formatProvenance(effective: AccessEffectiveResponse): ProvenanceLine[] {
  return effective.scopes.map((row) => ({
    scope: row.scope,
    sources: row.sources
      .map((s) => (s.kind === "direct" ? `direct (${s.name})` : `role ${s.name}`))
      .join(", "),
  }));
}
