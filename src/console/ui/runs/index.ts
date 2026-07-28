/**
 * Runs panel — population analysis of the wide-event store (console §9.11).
 *
 * Pure modules live here so `bun test src/console/ui/runs` gates behaviour
 * without mounting the full SPA.
 */

export { explainDurationOutliers, type OutlierFinding } from "./explain.ts";
export { RUNS_CHAIN_FIXTURE, RUNS_FIXTURE_T0, runsOutlierFixture } from "./fixture.ts";
export { discoverDimensions, groupByDimension } from "./group.ts";
export {
  DEFAULT_BUCKET_COUNT,
  durationHistogram,
  formatDurationMs,
  inDurationRange,
  normalizeRange,
} from "./histogram.ts";
export { rowToRun, runToWideEvent, type RunsListRow } from "./project.ts";
export {
  BUILDER_DIMENSIONS,
  dimensionValue,
  filterRuns,
  formatClause,
  matchesDimensionQuery,
  parseDimensionQuery,
  parseDurationMs,
  removeClause,
  serializeDimensionQuery,
  upsertClause,
} from "./query.ts";
export {
  closeRun,
  dimensionQueryOf,
  durationRangeOf,
  openRun,
  parseRunsSearch,
  RunsSearchSchema,
  serializeRunsSearch,
  setDurationRange,
  setGroup,
  setWhere,
  type RunsSearch,
} from "./search.ts";
export {
  rootIdOf,
  runsHrefForSpan,
  shouldOfferTracesLink,
  spanCountInTrace,
  tracesHrefForRun,
} from "./trace-link.ts";
export type {
  DimensionQuery,
  DurationBucket,
  DurationRange,
  GroupAggregate,
  QueryClause,
  QueryOp,
  RunEffect,
  RunLogLine,
  RunRecord,
} from "./types.ts";
