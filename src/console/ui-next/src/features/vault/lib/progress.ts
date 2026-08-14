/**
 * Honest dual-phase copy for master-key rotation progress.
 */

/** Dual-KEK vs retired-old-key phases. */
export type RewrapPhase = 1 | 2;

/** Operator-facing rewrap progress. */
export interface RewrapProgressLine {
  readonly phase: RewrapPhase;
  readonly headline: string;
  readonly detail: string;
}

/**
 * Format adapter-native rotate-master progress.
 *
 * Phase 1 (dual-read): both KEKs live; old key still required.
 * Phase 2 (done): old master key no longer opens the vault.
 *
 * @param options - Last batch + list status
 */
export function formatRewrapProgress(options: {
  readonly kekVersion: number;
  readonly remaining: number | null;
  readonly rewrapTargetKekVersion: number | null;
}): RewrapProgressLine | null {
  const remaining = options.remaining;
  const target = options.rewrapTargetKekVersion;
  const inFlight = (remaining !== null && remaining > 0) || target !== null;
  if (!inFlight) {
    if (remaining === 0) {
      return {
        phase: 2,
        headline: `KEK v${options.kekVersion} — rotation complete`,
        detail: "The previous master key no longer opens this vault.",
      };
    }
    return null;
  }
  const toward = target ?? options.kekVersion;
  const left = remaining ?? 0;
  return {
    phase: 1,
    headline: `kek v${options.kekVersion} → v${toward}`,
    detail:
      left > 0
        ? `${left} DEK${left === 1 ? "" : "s"} still on the old key. Both master keys stay live.`
        : "Both master keys stay live until remaining is 0.",
  };
}
