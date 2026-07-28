/**
 * Gates panel pure modules (console §9.7).
 */

export type {
  FlowGatesRecord,
  GateAuditRecord,
  GateDefRecord,
  GateDenialRecord,
  GateEvaluationRecord,
  GatePrincipalKind,
  GatesListGroup,
  GatesListResponse,
  PlaneViolationRecord,
  PowersResponse,
  PrincipalRecord,
  SimulateResponse,
  WideningRecord,
} from "./types.ts";

export { GATES_LIST_FIXTURE, SIMULATE_ALLOW_FIXTURE, SIMULATE_RATE_FIXTURE } from "./fixture.ts";

export {
  parseGatesSearch,
  serializeGatesSearch,
  encodePrincipal,
  decodePrincipal,
  openPrincipal,
  openFlow,
  type GatesSearch,
} from "./search.ts";

export { groupPrincipals, groupFlows } from "./group.ts";

export { auditLines, formatViolation, type AuditLine } from "./audit.ts";

export { unguardedFlowFindings } from "./findings.ts";

export { formatDenial, formatEvaluationStep } from "./denial.ts";
