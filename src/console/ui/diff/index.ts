/**
 * Manifest Diff panel pure modules (console §9.12).
 */

export type {
  DiffCategory,
  DiffCategoryGroup,
  DiffChangeRecord,
  DiffCiGate,
  DiffKind,
  DiffListResponse,
} from "./types.ts";

export {
  DIFF_EMPTY_BASELINE_FIXTURE,
  DIFF_LIST_FIXTURE,
} from "./fixture.ts";

export {
  filterCategory,
  openDiffPath,
  parseDiffSearch,
  serializeDiffSearch,
  type DiffSearch,
} from "./search.ts";

export {
  DIFF_CATEGORY_LABELS,
  DIFF_CATEGORY_ORDER,
  filterChanges,
  formatCiGate,
  groupByCategory,
} from "./group.ts";

export {
  whatChangedSummary,
  type DiffDeploySummary,
} from "./summary.ts";
