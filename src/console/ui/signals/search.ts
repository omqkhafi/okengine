/**
 * Typed search params for the Signals panel (console §7 · §9.4).
 */

import { z } from "zod";

/** Zod schema for Signals URL search params. */
export const SignalsSearchSchema = z.object({
  /** Free-text filter. */
  q: z.string().optional(),
  /** Open signal name. */
  signal: z.string().optional(),
  /** Open dead-letter id. */
  dlq: z.string().optional(),
  /** Live monitor paused. */
  paused: z
    .union([z.boolean(), z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === "true")),
  /** Bulk repair rate (messages/sec). */
  rate: z.coerce.number().min(1).max(1_000).optional(),
  /** Broadcast subscriber target for replay. */
  sub: z.string().optional(),
});

/** Parsed Signals search state. */
export type SignalsSearch = z.infer<typeof SignalsSearchSchema>;

/**
 * Parse URL search into Signals state.
 *
 * @param search - Raw router search
 */
export function parseSignalsSearch(search: Record<string, unknown>): SignalsSearch {
  const parsed = SignalsSearchSchema.safeParse(search);
  return parsed.success ? parsed.data : {};
}

/**
 * Serialize Signals search for the router (omit defaults).
 *
 * @param search - Current state
 */
export function serializeSignalsSearch(search: SignalsSearch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (search.q) out.q = search.q;
  if (search.signal) out.signal = search.signal;
  if (search.dlq) out.dlq = search.dlq;
  if (search.paused === true) out.paused = true;
  if (search.rate !== undefined && search.rate !== 10) out.rate = search.rate;
  if (search.sub) out.sub = search.sub;
  return out;
}

/**
 * Open a signal in the detail pane.
 *
 * @param search - Current
 * @param name - Signal name
 */
export function openSignal(search: SignalsSearch, name: string): SignalsSearch {
  return { ...search, signal: name, dlq: undefined };
}

/**
 * Close the detail pane.
 *
 * @param search - Current
 */
export function closeSignal(search: SignalsSearch): SignalsSearch {
  const { signal: _s, dlq: _d, ...rest } = search;
  return rest;
}

/**
 * Open a dead-letter detail.
 *
 * @param search - Current
 * @param id - Message id
 */
export function openDeadLetter(search: SignalsSearch, id: string): SignalsSearch {
  return { ...search, dlq: id };
}

/**
 * Close dead-letter detail (keep signal open).
 *
 * @param search - Current
 */
export function closeDeadLetter(search: SignalsSearch): SignalsSearch {
  const { dlq: _d, ...rest } = search;
  return rest;
}
