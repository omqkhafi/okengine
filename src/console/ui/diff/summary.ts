/**
 * Deploy summary for Overview "what changed" (console §9.12 · §9.16).
 *
 * Reads the Manifest Diff projection — never recomputes `diffManifest`.
 */

import { DIFF_CATEGORY_LABELS } from "./group.ts";
import type { DiffListResponse } from "./types.ts";

/** Linked summary of the most recent deploy's Manifest Diff. */
export interface DiffDeploySummary {
  readonly hasBaseline: boolean;
  readonly severity: DiffListResponse["severity"];
  readonly changeCount: number;
  readonly blockedCount: number;
  readonly acknowledgedCount: number;
  /** One-line plain-language summary. */
  readonly line: string;
  /** Deep-link into the Diff panel. */
  readonly href: string;
}

/**
 * Summarise the latest Manifest Diff projection for Overview.
 *
 * @param diff - `console.diff.list` response
 */
export function whatChangedSummary(diff: DiffListResponse): DiffDeploySummary {
  const href = "/diff";
  if (!diff.hasBaseline) {
    return {
      hasBaseline: false,
      severity: null,
      changeCount: 0,
      blockedCount: 0,
      acknowledgedCount: 0,
      line: "No prior deploy baseline — Manifest Diff has nothing to compare yet",
      href,
    };
  }

  const changeCount = diff.changes.length;
  if (changeCount === 0) {
    return {
      hasBaseline: true,
      severity: null,
      changeCount: 0,
      blockedCount: 0,
      acknowledgedCount: 0,
      line: "Last deploy changed nothing in the Manifest",
      href,
    };
  }

  const severityLabel = diff.severity != null ? DIFF_CATEGORY_LABELS[diff.severity] : "changes";
  const top = diff.changes[0]!;
  const gateNote =
    diff.blockedCount > 0
      ? ` · ${diff.blockedCount} blocked by CI`
      : diff.acknowledgedCount > 0
        ? ` · ${diff.acknowledgedCount} acknowledged break${diff.acknowledgedCount === 1 ? "" : "s"}`
        : "";

  return {
    hasBaseline: true,
    severity: diff.severity,
    changeCount,
    blockedCount: diff.blockedCount,
    acknowledgedCount: diff.acknowledgedCount,
    line: `${changeCount} Manifest change${changeCount === 1 ? "" : "s"} (${severityLabel}): ${top.summary}${gateNote}`,
    href,
  };
}
