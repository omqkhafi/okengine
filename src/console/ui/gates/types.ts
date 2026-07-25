/**
 * Gates panel view types (console §9.7).
 */

/** Principal kinds for the from-principal inquiry. */
export type GatePrincipalKind = "role" | "key" | "user";

/** Flow gate chain row. */
export interface FlowGatesRecord {
  readonly flowId: string;
  readonly plane: "user" | "operator";
  readonly gates: readonly string[];
  readonly unguarded: boolean;
}

/** Declared gate definition. */
export interface GateDefRecord {
  readonly name: string;
  readonly kind: "policy" | "rate";
  readonly scopes: readonly string[];
  readonly roles: readonly string[];
  readonly strategy?: string;
  readonly max?: number;
  readonly per?: string;
  readonly keyBy?: string;
  readonly overridable: boolean;
  readonly attachedTo: readonly string[];
}

/** Principal row (never an operator holding application scopes). */
export interface PrincipalRecord {
  readonly kind: GatePrincipalKind;
  readonly id: string;
  readonly name: string;
  readonly plane: "user" | "operator";
  readonly scopes: readonly string[];
  readonly memberCount?: number;
  readonly email?: string;
}

/** Two-plane violation — operator holding application scope. */
export interface PlaneViolationRecord {
  readonly kind: "operator-application-scope";
  readonly operatorId: string;
  readonly name: string;
  readonly email: string;
  readonly applicationScopes: readonly string[];
}

/** Continuous audit findings. */
export interface GateAuditRecord {
  readonly unguardedFlows: readonly string[];
  readonly orphanPermissions: readonly string[];
  readonly emptyRoles: readonly string[];
  readonly unattachedGates: readonly string[];
}

/** Permission-widening deploy diff line. */
export interface WideningRecord {
  readonly path: string;
  readonly category: string;
  readonly kind: string;
  readonly summary: string;
}

/** `console.gates.list` response. */
export interface GatesListResponse {
  readonly moduleActions: readonly string[];
  readonly flows: readonly FlowGatesRecord[];
  readonly gates: readonly GateDefRecord[];
  readonly principals: readonly PrincipalRecord[];
  readonly violations: readonly PlaneViolationRecord[];
  readonly audit: GateAuditRecord;
  readonly widenings: readonly WideningRecord[];
}

/** One evaluation step in the simulator. */
export interface GateEvaluationRecord {
  readonly name: string;
  readonly allowed: boolean;
  readonly kind: "policy" | "rate";
  readonly remaining?: number;
  readonly retryAfterMs?: number;
  readonly reason?: string;
}

/** Typed denial the client would receive. */
export interface GateDenialRecord {
  readonly code: "Unauthorized" | "Forbidden" | "RateLimited";
  readonly data: Readonly<Record<string, unknown>>;
  readonly status: 401 | 403 | 429;
}

/** `console.gates.simulate` response. */
export interface SimulateResponse {
  readonly flowId: string;
  readonly gates: readonly string[];
  readonly evaluations: readonly GateEvaluationRecord[];
  readonly deniedAt: string | null;
  readonly denial: GateDenialRecord | null;
  readonly allowed: boolean;
}

/** `console.gates.powers` response. */
export interface PowersResponse {
  readonly scopes: readonly string[];
  readonly allowedFlowIds: readonly string[];
  readonly deniedFlowIds: readonly string[];
}

/** Grouped list section for the bidirectional inquiry. */
export interface GatesListGroup {
  readonly id: string;
  readonly label: string;
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly meta?: string;
    readonly flag?: string;
  }>;
}
