/**
 * Run-now confirmation — external effects follow §10.5 (D).
 */

import { UNDO_WINDOW_MS, type ConfirmationPattern } from "../flows/confirmation.ts";
import type { ClockCronRecord } from "./types.ts";

export { UNDO_WINDOW_MS, validateTypedConfirm } from "../flows/confirmation.ts";
export type { ConfirmationPattern } from "../flows/confirmation.ts";

/**
 * Confirmation for running a cron now.
 *
 * External effects in production → typed `"RUN"` + reason.
 *
 * @param cron - Cron row
 * @param options - Environment
 */
export function runNowConfirmation(
  cron: ClockCronRecord,
  options: { readonly production: boolean } = { production: true },
): ConfirmationPattern {
  if (options.production && cron.external) {
    return {
      kind: "typed",
      phrase: "RUN",
      requireReason: true,
    };
  }
  return { kind: "undo", windowMs: UNDO_WINDOW_MS };
}
