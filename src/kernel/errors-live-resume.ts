/**
 * OKE1014 — kept off the Store-only `oke()` graph.
 *
 * Signal drivers throw this when a Last-Event-ID is missing from the tape.
 * Loaded via computed `import.meta.require` from {@link lookupOkeError}.
 */

import type { OkeErrorDefinition } from "./errors.ts";

/** Last-Event-ID is missing from the retained live tape. */
export const LIVE_RESUME_GAP: OkeErrorDefinition = {
  code: 1014,
  cause: 'Cursor "{afterId}" missing on "{signal}".',
  fix: "Reconnect without Last-Event-ID.",
};
