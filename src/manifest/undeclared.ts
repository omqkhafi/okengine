/**
 * Undeclared contract-break filter for the CI gate (console §9.12).
 *
 * The gate blocks the *undeclared* break, not the break. Setting
 * `breaking: true` on a flow allows that flow's contract-breaking changes
 * through; other flows without the acknowledgement still fail the gate.
 */

import { diffManifest } from "./diff.ts";
import type { Manifest, ManifestChange } from "./types.ts";

/**
 * Contract-breaking changes that lack a `breaking: true` acknowledgement
 * on the owning flow.
 *
 * @param before - Baseline manifest
 * @param after - Candidate manifest
 */
export function undeclaredContractBreaks(
  before: Manifest,
  after: Manifest,
): readonly ManifestChange[] {
  const { changes } = diffManifest(before, after);
  return changes.filter(
    (c) => c.category === "contract-breaking" && !isDeclaredBreak(c, before, after),
  );
}

/**
 * Whether a contract-breaking change is acknowledged via `breaking: true`.
 *
 * @param change - Classified change
 * @param before - Baseline
 * @param after - Candidate
 */
export function isDeclaredBreak(
  change: ManifestChange,
  before: Manifest,
  after: Manifest,
): boolean {
  const flowName = flowNameFromPath(change.path);
  if (flowName === null) return false;

  const afterFlow = after.flows?.[flowName];
  if (afterFlow?.breaking === true) return true;

  // Flow removal: acknowledgement lives on the baseline declaration.
  if (change.kind === "removed") {
    const beforeFlow = before.flows?.[flowName];
    if (beforeFlow?.breaking === true) return true;
  }

  return false;
}

/**
 * Extract `/flows/{name}` from a Manifest Diff path.
 *
 * @param path - Change path (e.g. `/flows/orders.create/trigger`)
 */
export function flowNameFromPath(path: string): string | null {
  const match = /^\/flows\/([^/]+)/.exec(path);
  return match?.[1] ?? null;
}
