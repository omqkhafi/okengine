/**
 * Continuous security audit copy (console §9.7).
 */

import type { GateAuditRecord, PlaneViolationRecord } from "./types.ts";

/** One audit line for the standing check banner. */
export interface AuditLine {
  readonly code: string;
  readonly message: string;
  readonly count: number;
}

/**
 * Summarise audit findings into standing-check lines.
 *
 * @param audit - Audit record
 */
export function auditLines(audit: GateAuditRecord): readonly AuditLine[] {
  const lines: AuditLine[] = [];
  if (audit.unguardedFlows.length > 0) {
    lines.push({
      code: "unguarded",
      count: audit.unguardedFlows.length,
      message: `${audit.unguardedFlows.length} user-plane flow${audit.unguardedFlows.length === 1 ? "" : "s"} unguarded (public)`,
    });
  }
  if (audit.orphanPermissions.length > 0) {
    lines.push({
      code: "orphan-permissions",
      count: audit.orphanPermissions.length,
      message: `${audit.orphanPermissions.length} permission${audit.orphanPermissions.length === 1 ? "" : "s"} granted to no role`,
    });
  }
  if (audit.emptyRoles.length > 0) {
    lines.push({
      code: "empty-roles",
      count: audit.emptyRoles.length,
      message: `${audit.emptyRoles.length} role${audit.emptyRoles.length === 1 ? "" : "s"} with no members`,
    });
  }
  if (audit.unattachedGates.length > 0) {
    lines.push({
      code: "unattached",
      count: audit.unattachedGates.length,
      message: `${audit.unattachedGates.length} gate${audit.unattachedGates.length === 1 ? "" : "s"} never attached`,
    });
  }
  return lines;
}

/**
 * Format a plane violation — never rendered as a normal principal row.
 *
 * @param violation - Violation record
 */
export function formatViolation(violation: PlaneViolationRecord): string {
  const scopes = violation.applicationScopes.join(", ");
  const who = violation.email
    ? `${violation.name} <${violation.email}>`
    : violation.name;
  return `${who} holds application scope(s): ${scopes}`;
}
