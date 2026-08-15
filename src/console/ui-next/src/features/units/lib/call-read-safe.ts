/**
 * Whether toggling Call API PII can re-invoke without a write side effect.
 */

import type { UnitFlowRow } from "./unit-tree.ts";

/**
 * True when the flow only reads (or has no effects) — safe to re-run on PII toggle.
 *
 * @param row - Selected Units flow
 */
export function isReadSafeCall(row: UnitFlowRow): boolean {
  const effects = row.flow.effects;
  if (!effects) return true;
  return (
    (effects.writes?.length ?? 0) === 0 &&
    (effects.emits?.length ?? 0) === 0 &&
    (effects.sends?.length ?? 0) === 0 &&
    (effects.asks?.length ?? 0) === 0
  );
}

/**
 * Re-invoke only when turning Include PII on. Remask is local — a second
 * call would clear the 200 chip and flash the JSON pane.
 *
 * @param row - Selected Units flow
 * @param nextMasked - Next PII-hidden state
 */
export function shouldRefetchCallOnPiiReveal(row: UnitFlowRow, nextMasked: boolean): boolean {
  return !nextMasked && isReadSafeCall(row);
}
