/**
 * URL search state for the Clock panel.
 */

import { z } from "zod";

const ClockSearchSchema = z.object({
  q: z.string().optional(),
  /** Open cron name. */
  cron: z.string().optional(),
  /** Open waiting-on run id. */
  wake: z.string().optional(),
  /** Active action in the detail pane. */
  action: z.enum(["run", "edit"]).optional(),
});

/** Parsed Clock URL search. */
export type ClockSearch = z.infer<typeof ClockSearchSchema>;

/**
 * Parse Clock panel search params.
 *
 * @param search - Raw router search
 */
export function parseClockSearch(
  search: Record<string, unknown>,
): ClockSearch {
  const parsed = ClockSearchSchema.safeParse(search);
  return parsed.success ? parsed.data : {};
}

/**
 * Serialize Clock search for navigation (omit empties).
 *
 * @param search - Search state
 */
export function serializeClockSearch(
  search: ClockSearch,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (search.q) out.q = search.q;
  if (search.cron) out.cron = search.cron;
  if (search.wake) out.wake = search.wake;
  if (search.action) out.action = search.action;
  return out;
}

/**
 * Open a cron in the URL.
 *
 * @param search - Current search
 * @param name - Cron name
 */
export function openCron(search: ClockSearch, name: string): ClockSearch {
  return { ...search, cron: name, wake: undefined, action: undefined };
}

/**
 * Open a waiting-on run in the URL.
 *
 * @param search - Current search
 * @param runId - Run id
 */
export function openWake(search: ClockSearch, runId: string): ClockSearch {
  return { ...search, wake: runId, cron: undefined, action: undefined };
}

/**
 * Close open detail.
 *
 * @param search - Current search
 */
export function closeClockDetail(search: ClockSearch): ClockSearch {
  const { cron: _c, wake: _w, action: _a, ...rest } = search;
  return rest;
}
