/**
 * Format Runs-queried key blast radius for the Access panel.
 */

import type { AccessBlastRadius } from "./types.ts";

/** Human-readable blast-radius lines. */
export interface AccessBlastRadiusLines {
  readonly volume: string;
  readonly lastUsed: string;
  readonly sources: string;
  readonly residual: string;
  readonly warn: boolean;
}

/**
 * Format blast radius for display.
 *
 * @param blast - Queried radius
 */
export function formatAccessBlastRadius(
  blast: AccessBlastRadius,
): AccessBlastRadiusLines {
  return {
    volume:
      blast.callVolume === 0
        ? "No recorded calls from Runs"
        : `${blast.callVolume} call${blast.callVolume === 1 ? "" : "s"} in Runs`,
    lastUsed:
      blast.lastUsedAt != null
        ? `Last used ${new Date(blast.lastUsedAt).toISOString()}`
        : "Never used",
    sources:
      blast.sourceAddresses.length === 0
        ? "No source addresses recorded"
        : `Source addresses: ${blast.sourceAddresses.join(", ")}`,
    residual: blast.residualAccessNote,
    warn: blast.callVolume > 0,
  };
}
