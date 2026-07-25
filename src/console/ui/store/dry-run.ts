/**
 * Preview / dry-run safety for Store mutations (console §9.5).
 *
 * Uses the same dual contract as Signals: irreversible effects stubbed,
 * writes rolled back — refuse when isolation cannot be guaranteed.
 */

import type { StoreRecord } from "./types.ts";

/** Whether the panel may offer a mutation preview. */
export type PreviewOffer =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Decide whether preview is offered for this store.
 *
 * @param store - Projected store row
 */
export function previewOffer(store: StoreRecord): PreviewOffer {
  if (store.facet === "index") {
    return {
      ok: false,
      reason:
        "Index facet has no bulk-update preview — similarity probe is read-only.",
    };
  }
  return { ok: true };
}
