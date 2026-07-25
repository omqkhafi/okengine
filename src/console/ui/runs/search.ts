/**
 * Typed search params for the Runs panel (console §7 · §9.11).
 *
 * Population query, group-by, duration brush, and open run all live in the URL.
 */

import { z } from "zod";
import {
  parseDimensionQuery,
  serializeDimensionQuery,
} from "./query.ts";
import type { DimensionQuery, DurationRange } from "./types.ts";

/** Zod schema for Runs URL search params. */
export const RunsSearchSchema = z.object({
  /** Dimension query expression (`flow = X AND cache = miss`). */
  where: z.string().optional(),
  /** Group-by dimension. */
  group: z.string().optional(),
  /** Open run id for the flat detail record. */
  run: z.string().optional(),
  /** Duration brush lower bound (ms). */
  durMin: z.coerce.number().optional(),
  /** Duration brush upper bound (ms). */
  durMax: z.coerce.number().optional(),
});

/** Parsed, typed Runs search state. */
export type RunsSearch = z.infer<typeof RunsSearchSchema>;

/**
 * Parse unknown search params into a typed {@link RunsSearch}.
 *
 * @param raw - Router search object
 */
export function parseRunsSearch(raw: unknown): RunsSearch {
  const result = RunsSearchSchema.safeParse(raw ?? {});
  if (result.success) return result.data;
  return RunsSearchSchema.parse({});
}

/**
 * Serialise typed search into a plain object for TanStack Router.
 *
 * @param search - Typed search
 */
export function serializeRunsSearch(
  search: RunsSearch,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (search.where) out.where = search.where;
  if (search.group) out.group = search.group;
  if (search.run) out.run = search.run;
  if (search.durMin !== undefined) out.durMin = search.durMin;
  if (search.durMax !== undefined) out.durMax = search.durMax;
  return out;
}

/**
 * Dimension query derived from search.
 *
 * @param search - Typed search
 */
export function dimensionQueryOf(search: RunsSearch): DimensionQuery {
  return parseDimensionQuery(search.where);
}

/**
 * Duration range when both bounds are present.
 *
 * @param search - Typed search
 */
export function durationRangeOf(search: RunsSearch): DurationRange | null {
  if (search.durMin === undefined || search.durMax === undefined) return null;
  return {
    minMs: Math.min(search.durMin, search.durMax),
    maxMs: Math.max(search.durMin, search.durMax),
  };
}

/**
 * Set the dimension query expression from a parsed query.
 *
 * @param prev - Current search
 * @param query - Dimension query
 */
export function setWhere(
  prev: RunsSearch,
  query: DimensionQuery,
): RunsSearch {
  const where = serializeDimensionQuery(query);
  return { ...prev, where: where || undefined };
}

/**
 * Set or clear the group-by dimension.
 *
 * @param prev - Current search
 * @param dimension - Dimension or null to clear
 */
export function setGroup(
  prev: RunsSearch,
  dimension: string | null,
): RunsSearch {
  return { ...prev, group: dimension ?? undefined };
}

/**
 * Open a run's flat detail record.
 *
 * @param prev - Current search
 * @param runId - Run id
 */
export function openRun(prev: RunsSearch, runId: string): RunsSearch {
  return { ...prev, run: runId };
}

/**
 * Close the detail view; stay on the Runs panel.
 *
 * @param prev - Current search
 */
export function closeRun(prev: RunsSearch): RunsSearch {
  return { ...prev, run: undefined };
}

/**
 * Set the duration brush (outlier population), or clear with null.
 *
 * @param prev - Current search
 * @param range - Selected range
 */
export function setDurationRange(
  prev: RunsSearch,
  range: DurationRange | null,
): RunsSearch {
  if (!range) {
    return { ...prev, durMin: undefined, durMax: undefined };
  }
  return { ...prev, durMin: range.minMs, durMax: range.maxMs };
}
