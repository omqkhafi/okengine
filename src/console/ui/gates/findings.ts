/**
 * Unguarded-flow findings for Overview aggregation (console §9.7 · §9.16).
 *
 * Delegates to {@link auditLines} — does not re-derive unguarded detection.
 */

import { auditLines, type AuditLine } from "./audit.ts";
import type { GateAuditRecord } from "./types.ts";

/**
 * Unguarded user-plane flows from the Gates standing audit.
 *
 * @param audit - Gates audit record
 */
export function unguardedFlowFindings(
  audit: GateAuditRecord,
): readonly AuditLine[] {
  return auditLines(audit).filter((line) => line.code === "unguarded");
}
