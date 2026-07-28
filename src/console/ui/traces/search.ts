/**
 * Typed search params for the Traces panel (console §7 · §9.3).
 *
 * Pasted links reproduce the exact view — open trace, focus span, effect
 * filter, expanded folds.
 */

import { z } from "zod";
import { parseEffectFilter, serializeEffectFilter, type EffectFilter } from "./filter.ts";

/** Zod schema for Traces URL search params. */
export const TracesSearchSchema = z.object({
  /** Open root / connected-component id (usually the root span id). */
  trace: z.string().optional(),
  /** Focused span within the open trace. */
  span: z.string().optional(),
  /** Effect filter compact form (`wrote:sql:bookings`, `cost:0.05`, …). */
  effect: z.string().optional(),
  /** Free-text filter (dims, never hides). */
  q: z.string().optional(),
  /** Comma-separated expanded fold ids. */
  folds: z.string().optional(),
  /** Flow selected for the full-trace boost control (UI only). */
  boost: z.string().optional(),
});

/** Parsed, typed Traces search state. */
export type TracesSearch = z.infer<typeof TracesSearchSchema>;

/**
 * Parse unknown search params into a typed {@link TracesSearch}.
 *
 * @param raw - Router search object
 */
export function parseTracesSearch(raw: unknown): TracesSearch {
  const result = TracesSearchSchema.safeParse(raw ?? {});
  if (result.success) return result.data;
  return TracesSearchSchema.parse({});
}

/**
 * Serialise typed search into a plain object suitable for TanStack Router.
 *
 * @param search - Typed search
 */
export function serializeTracesSearch(search: TracesSearch): Record<string, string> {
  const out: Record<string, string> = {};
  if (search.trace) out.trace = search.trace;
  if (search.span) out.span = search.span;
  if (search.effect) out.effect = search.effect;
  if (search.q) out.q = search.q;
  if (search.folds) out.folds = search.folds;
  if (search.boost) out.boost = search.boost;
  return out;
}

/**
 * Effect filter derived from search.
 *
 * @param search - Typed search
 */
export function effectFilterOf(search: TracesSearch): EffectFilter | null {
  return parseEffectFilter(search.effect);
}

/**
 * Expanded fold ids from search.
 *
 * @param search - Typed search
 */
export function expandedFoldsOf(search: TracesSearch): Set<string> {
  if (!search.folds) return new Set();
  return new Set(
    search.folds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Open a trace (root id) and optional focus span.
 *
 * @param prev - Current search
 * @param rootId - Root span id
 * @param spanId - Optional focus span
 */
export function openTrace(prev: TracesSearch, rootId: string, spanId?: string): TracesSearch {
  return {
    ...prev,
    trace: rootId,
    span: spanId,
  };
}

/**
 * Close the detail view; stay on the Traces panel.
 *
 * @param prev - Current search
 */
export function closeTrace(prev: TracesSearch): TracesSearch {
  return {
    ...prev,
    trace: undefined,
    span: undefined,
    folds: undefined,
  };
}

/**
 * Toggle a fold's expanded state in the URL.
 *
 * @param prev - Current search
 * @param foldId - Fold segment id
 */
export function toggleFold(prev: TracesSearch, foldId: string): TracesSearch {
  const set = expandedFoldsOf(prev);
  if (set.has(foldId)) set.delete(foldId);
  else set.add(foldId);
  const folds = [...set].join(",");
  return { ...prev, folds: folds || undefined };
}

/**
 * Set the effect filter (or clear with null).
 *
 * @param prev - Current search
 * @param filter - Effect filter
 */
export function setEffectFilter(prev: TracesSearch, filter: EffectFilter | null): TracesSearch {
  return {
    ...prev,
    effect: serializeEffectFilter(filter),
  };
}
