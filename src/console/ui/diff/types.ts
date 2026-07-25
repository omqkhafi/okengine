/**
 * Manifest Diff panel view types (console §9.12).
 */

/** Four blast-radius categories — mirrored from `diffManifest`, never recomputed. */
export type DiffCategory =
  | "contract-breaking"
  | "permission-widening"
  | "effect-widening"
  | "no-impact";

/** How a path changed. */
export type DiffKind = "added" | "removed" | "changed";

/** CI gate status for contract-breaking changes. */
export type DiffCiGate = "blocked" | "acknowledged";

/** One enriched change row from `console.diff.list`. */
export interface DiffChangeRecord {
  readonly path: string;
  readonly category: DiffCategory;
  readonly kind: DiffKind;
  readonly summary: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly flowName: string | null;
  readonly runCountLastWeek: number;
  readonly blastLine: string | null;
  readonly weeklyDeltaUsd: number | null;
  readonly weeklyBillLine: string | null;
  readonly ciGate: DiffCiGate | null;
}

/** `console.diff.list` response. */
export interface DiffListResponse {
  readonly hasBaseline: boolean;
  readonly severity: DiffCategory | null;
  readonly blockedCount: number;
  readonly acknowledgedCount: number;
  readonly changes: readonly DiffChangeRecord[];
}

/** Grouped section for the four categories. */
export interface DiffCategoryGroup {
  readonly category: DiffCategory;
  readonly label: string;
  readonly items: readonly DiffChangeRecord[];
}
