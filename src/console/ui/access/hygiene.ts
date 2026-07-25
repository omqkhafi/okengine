/**
 * Hygiene section copy — permissions grow by forgetting (console §9.14).
 */

import type { AccessHygieneRecord } from "./types.ts";

/** One hygiene finding line. */
export interface HygieneLine {
  readonly code: string;
  readonly message: string;
}

/**
 * Format hygiene findings for the standing section.
 *
 * @param hygiene - Projection hygiene
 */
export function hygieneLines(hygiene: AccessHygieneRecord): HygieneLine[] {
  const lines: HygieneLine[] = [];
  if (hygiene.unusedKeys.length > 0) {
    lines.push({
      code: "unused-keys",
      message: `${hygiene.unusedKeys.length} key${hygiene.unusedKeys.length === 1 ? "" : "s"} unused 90d+`,
    });
  }
  if (hygiene.neverSignedInOperators.length > 0) {
    lines.push({
      code: "never-signed-in",
      message: `${hygiene.neverSignedInOperators.length} operator${hygiene.neverSignedInOperators.length === 1 ? "" : "s"} never signed in`,
    });
  }
  if (hygiene.expiredInvitations.length > 0) {
    lines.push({
      code: "expired-invites",
      message: `${hygiene.expiredInvitations.length} expired invitation${hygiene.expiredInvitations.length === 1 ? "" : "s"}`,
    });
  }
  return lines;
}
