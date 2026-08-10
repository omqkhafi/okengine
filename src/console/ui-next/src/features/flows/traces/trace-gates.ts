/**
 * Resolve Gate element rows for the trace detail Sheet from run.gates + Manifest.
 */

import type { Manifest } from "../../../../../../manifest/types.ts";

/** One gate evaluated on a run, enriched from Manifest when present. */
export type TraceGateInfo = {
  /** Gate name from the run ledger. */
  readonly name: string;
  /** Manifest kind, or `null` when undeclared. */
  readonly kind: "policy" | "rate" | null;
  /** Manifest description, or `null` when undeclared. */
  readonly description: string | null;
};

/**
 * Project `run.gates` into display rows — Manifest fills kind/description.
 *
 * Unknown names still appear (ledger is source of truth).
 *
 * @param gateNames - Gate names from the projected run
 * @param manifest - Current Manifest snapshot (optional)
 */
export function traceGateInfos(
  gateNames: readonly string[],
  manifest: Manifest | null | undefined,
): readonly TraceGateInfo[] {
  const defs = manifest?.gates;
  return gateNames.map((name) => {
    const def = defs?.[name];
    return {
      name,
      kind: def?.kind ?? null,
      description: def?.description ?? null,
    };
  });
}
