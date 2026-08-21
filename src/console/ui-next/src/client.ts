/**
 * Thin Console client for ui-next — setup + session against the real kernel.
 * Same-origin `/console/*` (no mocks).
 */

import type { Manifest } from "../../../manifest/types.ts";

/** Session access token key (matches current Console SPA). */
export const ACCESS_TOKEN_KEY = "oke_console_at";

/** Operator identity key (name/email from claim or login / session/me). */
export const OPERATOR_KEY = "oke_console_operator";

let accessToken: string | null = null;

/** Setup / login / session-probe paths — a 401 here is not a mid-shell expiry. */
const AUTH_ENTRY_PATHS = new Set([
  "/console/setup/status",
  "/console/setup/claim",
  "/console/session/login",
  "/console/session/me",
  "/console/session/logout",
]);

let sessionExpired = false;
let onSessionExpired: ((returnTo: string) => void) | null = null;

/**
 * Register the SPA handler that sends an expired operator back to `/`.
 *
 * @param handler - Receives the current `pathname + search`, or null to clear
 */
export function setSessionExpiredHandler(handler: ((returnTo: string) => void) | null): void {
  onSessionExpired = handler;
}

/**
 * True when a Console API error means the operator session is gone.
 * Skips claim/login/`session/me` so the route guard can own that redirect.
 *
 * @param path - `/console/...` request path
 * @param error - API error envelope, if any
 */
export function shouldExpireSession(path: string, error: ConsoleApiError | null): boolean {
  return error?.code === "Unauthorized" && !AUTH_ENTRY_PATHS.has(path);
}

function expireSessionIfNeeded(path: string, error: ConsoleApiError | null): void {
  if (sessionExpired || !shouldExpireSession(path, error)) return;
  sessionExpired = true;
  setAccessToken(null);
  const returnTo =
    typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
  onSessionExpired?.(returnTo);
}

/**
 * Store the operator access token after a successful claim or login.
 *
 * @param token - Access token or null to clear
 */
export function setAccessToken(token: string | null): void {
  accessToken = token;
  if (token) {
    sessionExpired = false;
    sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(OPERATOR_KEY);
  }
}

/**
 * Restore the access token from sessionStorage (tab lifetime).
 */
export function restoreAccessToken(): void {
  accessToken = sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

/**
 * Current in-memory access token, if any.
 */
export function getAccessToken(): string | null {
  return accessToken;
}

/** Operator identity shown in the shell footer. */
export type SessionOperator = {
  readonly operatorId: string;
  readonly email: string;
  readonly name: string;
};

/**
 * Persist operator identity alongside the access token.
 *
 * @param operator - Operator from claim/login/`session/me`, or null to clear
 */
export function setSessionOperator(operator: SessionOperator | null): void {
  if (operator) {
    sessionStorage.setItem(OPERATOR_KEY, JSON.stringify(operator));
  } else {
    sessionStorage.removeItem(OPERATOR_KEY);
  }
}

/**
 * Read persisted operator identity from sessionStorage.
 */
export function getSessionOperator(): SessionOperator | null {
  const raw = sessionStorage.getItem(OPERATOR_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SessionOperator>;
    if (
      typeof parsed.operatorId === "string" &&
      typeof parsed.email === "string" &&
      typeof parsed.name === "string"
    ) {
      return {
        operatorId: parsed.operatorId,
        email: parsed.email,
        name: parsed.name,
      };
    }
  } catch {
    // ignore corrupt storage
  }
  return null;
}

/**
 * Apply a successful claim or login session (token + operator identity).
 *
 * @param session - SessionOut from claim or login
 */
export function applySession(session: SessionOut): void {
  setAccessToken(session.accessToken);
  setSessionOperator({
    operatorId: session.operatorId,
    email: session.email,
    name: session.name,
  });
}

/** Console API error envelope. */
export type ConsoleApiError = {
  readonly code: string;
  readonly message?: string;
  readonly data?: unknown;
};

/** Console API result envelope. */
export type ConsoleApiResult<T> = {
  readonly data: T | null;
  readonly error: ConsoleApiError | null;
};

/** Setup status payload. */
export type SetupStatus = {
  readonly setupClosed: boolean;
  readonly claimRequired: boolean;
};

/** Claim request body (matches server ClaimIn). */
export type SetupClaimInput = {
  readonly claimCode: string;
  readonly email: string;
  readonly name: string;
  readonly password: string;
};

/**
 * Session success payload (claim + login — matches server SessionOut).
 */
export type SessionOut = {
  readonly operatorId: string;
  readonly email: string;
  readonly name: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: number;
};

/** Claim success payload alias (matches server SessionOut). */
export type SetupClaimResult = SessionOut;

/** Login request body (matches server LoginIn). */
export type SessionLoginInput = {
  readonly email: string;
  readonly password: string;
};

/** GET /console/session/me payload (matches server MeOut). */
export type SessionMe = {
  readonly operatorId: string;
  readonly email: string;
  readonly name: string;
  readonly setupClosed: boolean;
};

/**
 * Prefer human message / reason over a bare error code (matches current Wizard).
 *
 * @param error - API error envelope
 */
export function clientErrorText(error: ConsoleApiError): string {
  if (typeof error.message === "string" && error.message.trim().length > 0) {
    return error.message;
  }
  if (error.data !== null && typeof error.data === "object") {
    const data = error.data as { message?: unknown; reason?: unknown };
    if (typeof data.message === "string" && data.message.trim().length > 0) {
      return data.message;
    }
    if (typeof data.reason === "string" && data.reason.trim().length > 0) {
      return data.reason;
    }
  }
  return error.code;
}

async function consoleFetch<T>(path: string, init?: RequestInit): Promise<ConsoleApiResult<T>> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }
  if (accessToken && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }
  const res = await fetch(path, { ...init, headers });
  const body = (await res.json()) as ConsoleApiResult<T>;
  expireSessionIfNeeded(path, body.error);
  return body;
}

/**
 * GET /console/setup/status
 */
export async function setupStatus(): Promise<ConsoleApiResult<SetupStatus>> {
  return consoleFetch<SetupStatus>("/console/setup/status");
}

/**
 * POST /console/setup/claim
 *
 * @param body - Claim payload
 */
export async function setupClaim(body: SetupClaimInput): Promise<ConsoleApiResult<SessionOut>> {
  return consoleFetch<SessionOut>("/console/setup/claim", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * POST /console/session/login
 *
 * @param body - Email + password
 */
export async function sessionLogin(body: SessionLoginInput): Promise<ConsoleApiResult<SessionOut>> {
  return consoleFetch<SessionOut>("/console/session/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * GET /console/session/me — validate the current operator session.
 */
export async function sessionMe(): Promise<ConsoleApiResult<SessionMe>> {
  return consoleFetch<SessionMe>("/console/session/me");
}

/** POST /console/session/logout payload (matches server `{ ok: true }`). */
export type SessionLogout = {
  readonly ok: true;
};

/**
 * POST /console/session/logout — end the operator session and clear cookies.
 */
export async function sessionLogout(): Promise<ConsoleApiResult<SessionLogout>> {
  return consoleFetch<SessionLogout>("/console/session/logout", { method: "POST" });
}

/** Manifest snapshot payload (`GET /console/manifest`). */
export type ManifestPayload = {
  readonly manifest: Manifest | null;
};

/**
 * GET /console/manifest — Manifest snapshot for the Flow graph.
 */
export async function manifestGet(): Promise<ConsoleApiResult<ManifestPayload>> {
  return consoleFetch<ManifestPayload>("/console/manifest");
}

/** One Gate row from `GET /console/gates`. */
export type GatesListGate = {
  readonly name: string;
  readonly description?: string;
  readonly kind: "policy" | "rate";
  readonly scopes: readonly string[];
  readonly roles: readonly string[];
  readonly attachedTo: readonly string[];
};

/** One principal row from `GET /console/gates`. */
export type GatesListPrincipal = {
  readonly kind: "role" | "key" | "user";
  readonly id: string;
  readonly name: string;
  readonly plane: "user" | "operator";
  readonly scopes: readonly string[];
};

/** Gates panel payload (`GET /console/gates`). */
export type GatesListPayload = {
  readonly moduleActions: readonly string[];
  readonly gates: readonly GatesListGate[];
  readonly principals: readonly GatesListPrincipal[];
};

/**
 * GET /console/gates — Module:Action catalog, declared gates, Access principals.
 */
export async function gatesList(): Promise<ConsoleApiResult<GatesListPayload>> {
  return consoleFetch<GatesListPayload>("/console/gates");
}

/** Effect entry on a run row (matches server `RunsListOut`). */
export type RunEffect = {
  readonly kind: "read" | "write" | "emit" | "send" | "ask" | "secret" | "call";
  readonly resource: string;
  readonly timestamp: number;
  readonly duration: number;
  readonly reversibility:
    | "none"
    | "reversible"
    | "deferred"
    | "irreversible"
    | "capability"
    | "portal";
};

/** Log line on a run row (matches server `RunsListOut`). */
export type RunLog = {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly data?: Record<string, unknown>;
  readonly at: number;
};

/** One run row from `GET /console/runs` (matches server `projectRun`). */
export type RunRow = {
  readonly id: string;
  readonly parentId: string | null;
  readonly flow: string;
  readonly unit: string | null;
  readonly trigger: string;
  readonly plane: string;
  readonly tenant: string | null;
  readonly principal: string | null;
  readonly gates: readonly string[];
  readonly cache: "hit" | "miss" | "none";
  readonly replica: "primary" | "replica" | null;
  readonly replicaLagMs: number | null;
  readonly cost: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly promptVersion: number | null;
  readonly buildVersion: string | null;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly error: string | null;
  /** Optional human message paired with {@link error}. */
  readonly errorMessage: string | null;
  readonly sampled: "full" | "error" | "sample" | "boost";
  readonly effects: readonly RunEffect[];
  readonly logs: readonly RunLog[];
  readonly dimensions: Record<string, string | number | boolean | null>;
  /**
   * Validated flow input snapshot (powers replay). `null` when the run has
   * no stored input.
   */
  readonly input: unknown;
  /**
   * Flow return value snapshot. `null` when the run has no stored output
   * (failures, sleeps, or legacy rows).
   */
  readonly output: unknown;
};

/** Runs list payload (`GET /console/runs`). */
export type RunsListPayload = {
  readonly runs: RunRow[];
};

/**
 * GET /console/runs — recent wide events for the Traces pane.
 */
export async function runsList(): Promise<ConsoleApiResult<RunsListPayload>> {
  return consoleFetch<RunsListPayload>("/console/runs");
}

/** Request body for `POST /console/runs/query`. */
export type RunsQueryInput = {
  readonly sql: string;
  readonly revealPii?: boolean;
};

/** Success payload from `POST /console/runs/query`. */
export type RunsQueryResult = {
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly truncated: boolean;
  readonly rowCount: number;
  readonly masked: "column-keys";
  readonly durationMs: number;
  readonly limitation: "RunsQueryPiiProjectionGap";
  readonly injectedLimit: boolean;
};

/**
 * POST /console/runs/query — sandboxed DuckDB SQL over persisted runs.
 * PII masking is column-key only (`RunsQueryPiiProjectionGap`).
 *
 * @param body - SQL + optional reveal
 */
export async function runsQuery(body: RunsQueryInput): Promise<ConsoleApiResult<RunsQueryResult>> {
  return consoleFetch<RunsQueryResult>("/console/runs/query", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Request body for `POST /console/traces/replay`. */
export type TracesReplayInput = {
  readonly rootId: string;
  readonly dryRun: boolean;
};

/** Success payload from `POST /console/traces/replay`. */
export type TracesReplayResult = {
  readonly ok: true;
  readonly rootId: string;
  readonly dryRun: boolean;
  readonly at: string;
  readonly flow: string;
};

/**
 * POST /console/traces/replay — re-invoke a past run via the same path as `oke replay`.
 *
 * @param body - Root run id + dry-run preference
 */
export async function tracesReplay(
  body: TracesReplayInput,
): Promise<ConsoleApiResult<TracesReplayResult>> {
  return consoleFetch<TracesReplayResult>("/console/traces/replay", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** One identity from `GET /console/flows/identities`. */
export type FlowIdentity = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: string;
  readonly scopes: readonly string[];
};

/** Identities list payload. */
export type FlowsIdentitiesPayload = {
  readonly identities: readonly FlowIdentity[];
};

/**
 * GET /console/flows/identities — invoke-as picker.
 */
export async function flowsIdentities(): Promise<ConsoleApiResult<FlowsIdentitiesPayload>> {
  return consoleFetch<FlowsIdentitiesPayload>("/console/flows/identities");
}

/** Request body for `POST /console/flows/invoke`. */
export type FlowsInvokeInput = {
  readonly flowId: string;
  readonly body: unknown;
  /** Seeded identity id when Invoke As → User. Omit for Operator / Public / policy. */
  readonly asUserId?: string;
  /** `public` or a policy Gate name. Omit for Operator bypass. */
  readonly asGate?: string;
  readonly pathParams?: Readonly<Record<string, string>>;
  readonly confirmation?: string;
  readonly reason?: string;
  /** Return classified PII in the handler response (audited). */
  readonly revealPii?: boolean;
};

/** Success payload from `POST /console/flows/invoke`. */
export type FlowsInvokeResult = {
  readonly ok: true;
  readonly flowId: string;
  readonly asUserId: string;
  readonly asGate?: string | null;
  readonly rls?: {
    readonly gate: string | null;
    readonly userId: string;
    readonly applied: boolean;
  };
  readonly trigger: string;
  readonly response: unknown;
  /** True when classified PII keys were redacted. */
  readonly masked: boolean;
  readonly status?: number;
  readonly failure?: {
    readonly code: string;
    readonly data?: unknown;
    readonly message?: string;
  };
  readonly runId?: string;
  /** Host telemetry cache dimension when the invoke adapter reported one. */
  readonly cache?: "hit" | "miss" | "none";
  /** Handler duration from the host execute (high-res ms). */
  readonly durationMs?: number;
  readonly peakTier: string;
  readonly auditedAt: number;
};

/**
 * POST /console/flows/invoke — real host invoke-as (operator session).
 *
 * @param body - Flow id, body, assumed identity
 */
export async function flowsInvoke(
  body: FlowsInvokeInput,
): Promise<ConsoleApiResult<FlowsInvokeResult>> {
  return consoleFetch<FlowsInvokeResult>("/console/flows/invoke", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Cron health from `GET /console/clock`. */
export type ClockCronHealth = {
  readonly driftMs: number | null;
  readonly overdue: boolean;
  readonly missedRuns: number;
  readonly catchUp: "one";
  readonly leaderInstanceId?: string;
  readonly leaderLeaseUntil?: number;
};

/** One cron row from `GET /console/clock`. */
export type ClockListCron = {
  readonly name: string;
  readonly status: "active" | "paused" | "orphaned";
  readonly health: ClockCronHealth;
};

/** Clock list payload (`GET /console/clock`). */
export type ClockListPayload = {
  readonly now: number;
  readonly crons: readonly ClockListCron[];
};

/**
 * GET /console/clock — cron health + lease holder (not a fleet registry).
 */
export async function clockList(): Promise<ConsoleApiResult<ClockListPayload>> {
  return consoleFetch<ClockListPayload>("/console/clock");
}

/** Clock lease currently held by an instance (`GET /console/instances`). */
export type InstanceClockLease = {
  readonly name: string;
  readonly leaseUntil: number;
};

/** Journal run lease currently held by an instance (`GET /console/instances`). */
export type InstanceJournalLease = {
  readonly runId: string;
  readonly flow: string;
  readonly leaseUntil: number;
};

/** One live instance from `GET /console/instances`. */
export type InstanceDetail = {
  readonly id: string;
  readonly startedAt: number;
  readonly heartbeatAt: number;
  readonly leaseExpiresAt: number;
  readonly env: "dev" | "test" | "prod";
  readonly pid?: number;
  readonly clock: readonly InstanceClockLease[];
  readonly journal: readonly InstanceJournalLease[];
};

/** Registry unbound — not a zero count. */
export type InstancesListEmpty = {
  readonly kind: "empty";
};

/** Live fleet snapshot. */
export type InstancesListFleet = {
  readonly kind: "fleet";
  readonly now: number;
  readonly alive: number;
  readonly instances: readonly InstanceDetail[];
};

/** Fleet list payload (`GET /console/instances`). */
export type InstancesListPayload = InstancesListEmpty | InstancesListFleet;

/**
 * GET /console/instances — live process count + lease ownership snapshot.
 */
export async function instancesList(): Promise<ConsoleApiResult<InstancesListPayload>> {
  return consoleFetch<InstancesListPayload>("/console/instances");
}

/** One signal row from `GET /console/signals`. */
export type SignalsListRow = {
  readonly name: string;
  readonly pending: number;
  readonly inflight: number;
  readonly dead: number;
  readonly outboxLagMs: number | null;
};

/** Signals list payload (`GET /console/signals`). */
export type SignalsListPayload = {
  readonly signals: readonly SignalsListRow[];
};

/**
 * GET /console/signals — queue lag / depth from the Console host bus.
 */
export async function signalsList(): Promise<ConsoleApiResult<SignalsListPayload>> {
  return consoleFetch<SignalsListPayload>("/console/signals");
}

/** Per-prompt-version metrics from `GET /console/ai`. */
export type AiListVersion = {
  readonly prompt: string;
  readonly version: number;
  readonly sampleCount: number;
  readonly cost: {
    readonly mean: number;
    readonly p95: number;
  };
};

/** AI list payload (`GET /console/ai`). */
export type AiListPayload = {
  readonly prompts: ReadonlyArray<{ readonly name: string }>;
  readonly versions: readonly AiListVersion[];
};

/**
 * GET /console/ai — catalogue + journal metrics (often empty on a real host).
 */
export async function aiList(): Promise<ConsoleApiResult<AiListPayload>> {
  return consoleFetch<AiListPayload>("/console/ai");
}

/** Request body for `POST /console/clock/run-now`. */
export type ClockRunNowInput = {
  readonly name: string;
  readonly confirmation?: string;
  readonly reason?: string;
};

/** Success payload from `POST /console/clock/run-now`. */
export type ClockRunNowResult = {
  readonly ok: true;
  readonly name: string;
  readonly ran: boolean;
  readonly at: string;
};

/**
 * POST /console/clock/run-now — lease-gated cron tick (Clock panel).
 *
 * @param body - Clock name + optional typed confirmation
 */
export async function clockRunNow(
  body: ClockRunNowInput,
): Promise<ConsoleApiResult<ClockRunNowResult>> {
  return consoleFetch<ClockRunNowResult>("/console/clock/run-now", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Store facet from `GET /console/store` / query. */
export type StoreFacet = "sql" | "kv" | "files" | "index";

/** Will-not-fire projection on a store child (matches server `WillNotFireOut`). */
export type StoreWillNotFire = {
  readonly writerFlowIds: readonly string[];
  readonly signals: readonly string[];
  readonly channels: readonly string[];
};

/** Cache sub-view on a store child. */
export type StoreChildCache = {
  readonly producedByRead: string;
  readonly invalidatedByWrites: readonly string[];
  readonly invalidatingFlowIds: readonly string[];
};

/** Child resource under a store (table / namespace / bucket / index). */
export type StoreListChild = {
  readonly name: string;
  readonly effectRef: string;
  readonly kind?: "table" | "index" | "function" | "trigger" | "extension" | "policy";
  readonly writers: readonly string[];
  readonly readers: readonly string[];
  readonly cache: StoreChildCache;
  readonly willNotFire: StoreWillNotFire;
  readonly piiColumns: readonly string[];
  readonly columnDescriptions: Readonly<Record<string, string>>;
  /** Live RLS when the engine reported `pg_class.relrowsecurity`. */
  readonly rls?: boolean;
  /** Live + declared RLS policy count when the child is a SQL table. */
  readonly rlsPolicyCount?: number;
};

/** One store row from `GET /console/store` (matches server `StoreListOut`). */
export type StoreListStore = {
  readonly ref: string;
  readonly facet: StoreFacet;
  readonly name: string;
  readonly description?: string;
  readonly children: readonly StoreListChild[];
  readonly replicaLagMs: number | null;
  readonly migrationDrift: {
    readonly declared: string;
    readonly applied: string | null;
    readonly drifted: boolean;
  } | null;
  readonly contentAddressed: boolean;
  /** Files driver when the Console could open the handle. */
  readonly driverId?: "memory" | "fs" | "s3";
  readonly warnings: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly key: string;
  }>;
};

/** Store list payload (`GET /console/store`). */
export type StoreListPayload = {
  readonly tenancyDeclared: boolean;
  readonly tenants: readonly string[];
  readonly stores: readonly StoreListStore[];
};

/**
 * GET /console/store — projected Manifest stores for operator browse.
 */
export async function storeList(): Promise<ConsoleApiResult<StoreListPayload>> {
  return consoleFetch<StoreListPayload>("/console/store");
}

/** Request body for `QUERY /console/store/query`. */
export type StoreQueryInput = {
  readonly ref: string;
  readonly child?: string;
  readonly tenant?: string;
  readonly prefix?: string;
  readonly limit?: number;
  readonly vector?: readonly number[];
  readonly q?: string;
  readonly topK?: number;
  /** When true, SQL browse returns PII cleartext (audited). Default masks. */
  readonly revealPii?: boolean;
  readonly asGate?: string;
  readonly asUserId?: string;
};

/** Success payload from `QUERY /console/store/query` (matches server `StoreQueryOut`). */
export type StoreQueryResult = {
  readonly facet: StoreFacet;
  readonly rows?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly keys?: ReadonlyArray<{
    readonly key: string;
    readonly value?: unknown;
    readonly ttlMs?: number | null;
    readonly sizeBytes?: number;
    readonly originalName?: string;
    readonly warnings?: ReadonlyArray<{ readonly code: string; readonly message: string }>;
  }>;
  readonly hits?: ReadonlyArray<{
    readonly id: string;
    readonly score: number;
    readonly meta?: Readonly<Record<string, unknown>>;
  }>;
  readonly masked: boolean;
  readonly routedRole?: "primary" | "replica";
  readonly rls?: {
    readonly gate: string | null;
    readonly userId: string;
    readonly applied: boolean;
  };
};

/**
 * QUERY /console/store/query — browse rows / keys / hits (PII masked unless `revealPii`).
 *
 * @param body - Store ref + child + browse options
 */
export async function storeQuery(
  body: StoreQueryInput,
): Promise<ConsoleApiResult<StoreQueryResult>> {
  return consoleFetch<StoreQueryResult>("/console/store/query", {
    method: "QUERY",
    body: JSON.stringify(body),
  });
}

/** Request body for `POST /console/store/reveal`. */
export type StoreRevealInput = {
  readonly ref: string;
  readonly child?: string;
  readonly tenant?: string;
  readonly id: string;
  readonly column: string;
};

/** Success payload from `POST /console/store/reveal` (matches server `StoreRevealOut`). */
export type StoreRevealResult = {
  readonly ok: true;
  readonly value: unknown;
  readonly at: string;
};

/**
 * POST /console/store/reveal — audited cleartext for one masked PII cell.
 *
 * @param body - Row id + column under a store child
 */
export async function storeReveal(
  body: StoreRevealInput,
): Promise<ConsoleApiResult<StoreRevealResult>> {
  return consoleFetch<StoreRevealResult>("/console/store/reveal", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Request body for `POST /console/store/edit` (and `/preview`). */
export type StoreEditInput = {
  readonly ref: string;
  readonly child?: string;
  readonly tenant?: string;
  /** Existing row id. Omit to INSERT; `patch` must include `id`. */
  readonly id?: string;
  readonly key?: string;
  readonly patch: Record<string, unknown>;
  readonly confirmation?: string;
  readonly reason?: string;
  readonly commit?: boolean;
  readonly asGate?: string;
  readonly asUserId?: string;
};

/** Success payload from `POST /console/store/edit` (matches server). */
export type StoreEditResult = {
  readonly ok: true;
  readonly dryRun: boolean;
  readonly applied: boolean;
  readonly willNotFire: StoreWillNotFire;
  readonly wouldHaveFired: ReadonlyArray<{
    readonly kind: "send" | "ask";
    readonly resource: string;
  }>;
  readonly at: string;
  readonly rls?: {
    readonly gate: string | null;
    readonly userId: string;
    readonly applied: boolean;
  };
};

/**
 * POST /console/store/edit — dry-run by default; `commit: true` applies.
 *
 * @param body - Edit payload (typed confirmation required in production)
 */
export async function storeEdit(body: StoreEditInput): Promise<ConsoleApiResult<StoreEditResult>> {
  return consoleFetch<StoreEditResult>("/console/store/edit", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * POST /console/store/preview — always dry-run; inspect willNotFire before commit.
 *
 * @param body - Edit payload without confirmation
 */
export async function storePreview(
  body: Omit<StoreEditInput, "confirmation" | "reason" | "commit">,
): Promise<ConsoleApiResult<StoreEditResult>> {
  return consoleFetch<StoreEditResult>("/console/store/preview", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Request body for `POST /console/store/delete`. */
export type StoreDeleteInput = {
  readonly ref: string;
  readonly child?: string;
  readonly tenant?: string;
  readonly ids?: readonly string[];
  readonly keys?: readonly string[];
  readonly confirmation?: string;
  readonly reason?: string;
};

/** Success payload from `POST /console/store/delete`. */
export type StoreDeleteResult = {
  readonly ok: true;
  readonly deleted: number;
  readonly at: string;
};

/**
 * POST /console/store/delete — delete rows/keys (typed confirmation in production).
 *
 * @param body - Delete payload
 */
export async function storeDelete(
  body: StoreDeleteInput,
): Promise<ConsoleApiResult<StoreDeleteResult>> {
  return consoleFetch<StoreDeleteResult>("/console/store/delete", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Request body for `POST /console/store/sql`. */
export type StoreSqlInput = {
  readonly ref: string;
  readonly sql: string;
  readonly tenant?: string;
  readonly allowWrite?: boolean;
  /** When true, classified columns return cleartext (audited). Default masks. */
  readonly revealPii?: boolean;
  /** View rows as this Gate (`oke.gate` on postgres / pglite). */
  readonly asGate?: string;
  readonly asUserId?: string;
};

/** Success payload from `POST /console/store/sql` (matches server `StoreSqlOut`). */
export type StoreSqlResult = {
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly masked: boolean;
  readonly routedRole: "primary" | "replica";
  readonly asGate: string | null;
  readonly asUserId: string | null;
  readonly gateApplied: boolean;
  readonly rls?: {
    readonly gate: string | null;
    readonly userId: string;
    readonly applied: boolean;
  };
};

/**
 * POST /console/store/sql — raw SQL console (read-only unless `allowWrite`).
 * PII-classified columns stay masked unless `revealPii` is true.
 *
 * @param body - Store ref + SQL
 */
export async function storeSql(body: StoreSqlInput): Promise<ConsoleApiResult<StoreSqlResult>> {
  return consoleFetch<StoreSqlResult>("/console/store/sql", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Named limitation for engine-native query text. */
export const STORE_SQL_STATS_PII_GAP = "StoreSqlStatsQueryTextGap" as const;

/** Request body for `QUERY /console/store/sql/stats`. */
export type StoreSqlStatsInput = {
  readonly ref: string;
  readonly tenant?: string;
};

/** One pg_stat_statements row from the stats endpoint. */
export type StoreSqlStatementRow = {
  readonly queryid: string | null;
  readonly query: string | null;
  readonly calls: number;
  readonly totalExecMs: number;
  readonly meanExecMs: number;
  readonly minExecMs: number;
  readonly maxExecMs: number;
  readonly rows: number;
  readonly sharedBlksHit: number;
  readonly sharedBlksRead: number;
  readonly cacheHitRate: number | null;
};

/** Success payload from `QUERY /console/store/sql/stats`. */
export type StoreSqlStatsResult = {
  readonly statements: readonly StoreSqlStatementRow[];
  readonly kpis: {
    readonly slowQueries: number;
    readonly cacheHitRate: number | null;
    readonly avgRowsPerCall: number | null;
  };
  readonly limitation: typeof STORE_SQL_STATS_PII_GAP;
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly advisor: {
    readonly available: boolean;
    readonly installed: boolean;
    readonly hypopgAvailable: boolean;
  };
};

/**
 * QUERY /console/store/sql/stats — pg_stat_statements + KPIs.
 *
 * @param body - SQL store ref
 */
export async function storeSqlStats(
  body: StoreSqlStatsInput,
): Promise<ConsoleApiResult<StoreSqlStatsResult>> {
  return consoleFetch<StoreSqlStatsResult>("/console/store/sql/stats", {
    method: "QUERY",
    body: JSON.stringify(body),
  });
}

/** Request body for `QUERY /console/store/sql/locks`. */
export type StoreSqlLocksInput = {
  readonly ref: string;
  readonly tenant?: string;
  readonly revealPii?: boolean;
};

/** One blocking pair from the locks endpoint. */
export type StoreSqlLockRow = {
  readonly blockedPid: number | null;
  readonly blockedUser: string | null;
  readonly blockedQuery: string | null;
  readonly blockedAt: string | null;
  readonly blockingPid: number | null;
  readonly blockingUser: string | null;
  readonly blockingQuery: string | null;
  readonly blockingState: string | null;
  readonly waitEventType: string | null;
  readonly waitEvent: string | null;
};

/** Success payload from `QUERY /console/store/sql/locks`. */
export type StoreSqlLocksResult = {
  readonly rows: readonly StoreSqlLockRow[];
  readonly masked: boolean;
  readonly limitation: typeof STORE_SQL_STATS_PII_GAP;
  readonly pollingMs: number;
};

/**
 * QUERY /console/store/sql/locks — who's blocking whom.
 *
 * @param body - SQL store ref + optional reveal
 */
export async function storeSqlLocks(
  body: StoreSqlLocksInput,
): Promise<ConsoleApiResult<StoreSqlLocksResult>> {
  return consoleFetch<StoreSqlLocksResult>("/console/store/sql/locks", {
    method: "QUERY",
    body: JSON.stringify(body),
  });
}

/** Request body for `POST /console/store/sql/advise`. */
export type StoreSqlAdviseInput = {
  readonly ref: string;
  readonly query: string;
  readonly tenant?: string;
};

/** Success payload from `POST /console/store/sql/advise`. */
export type StoreSqlAdviseResult = {
  readonly startupCostBefore: unknown;
  readonly startupCostAfter: unknown;
  readonly totalCostBefore: unknown;
  readonly totalCostAfter: unknown;
  readonly indexStatements: readonly string[];
  readonly errors: readonly string[];
};

/**
 * POST /console/store/sql/advise — `index_advisor(query)`.
 *
 * @param body - Store ref + captured statement text
 */
export async function storeSqlAdvise(
  body: StoreSqlAdviseInput,
): Promise<ConsoleApiResult<StoreSqlAdviseResult>> {
  return consoleFetch<StoreSqlAdviseResult>("/console/store/sql/advise", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Named limitation: INFO is instance-wide, not `oke:kv:{ns}:`. */
export const STORE_KV_STATS_SERVER_WIDE_GAP = "StoreKvStatsServerWideGap" as const;

/** Named limitation: SLOWLOG args include keys and values. */
export const STORE_KV_STATS_SLOWLOG_ARGS_GAP = "StoreKvStatsSlowlogArgsGap" as const;

/** Request body for `QUERY /console/store/kv/stats`. */
export type StoreKvStatsInput = {
  readonly ref: string;
  readonly tenant?: string;
  readonly revealPii?: boolean;
};

/** One INFO commandstats row. */
export type StoreKvCommandStatRow = {
  readonly command: string;
  readonly calls: number;
  readonly usec: number;
  readonly usecPerCall: number | null;
};

/** One SLOWLOG row (args collapsed unless reveal). */
export type StoreKvSlowlogRow = {
  readonly id: number;
  readonly timestamp: number;
  readonly durationUs: number;
  readonly command: string;
  readonly args: readonly string[];
};

/** Success payload from `QUERY /console/store/kv/stats`. */
export type StoreKvStatsResult = {
  readonly engine: "redis" | "memory";
  readonly kpis: {
    readonly hitRate: number | null;
    readonly opsPerSec: number | null;
    readonly evictedKeys: number | null;
    readonly expiredKeys: number | null;
  };
  readonly commands: readonly StoreKvCommandStatRow[];
  readonly slowlog: readonly StoreKvSlowlogRow[];
  readonly latency: ReadonlyArray<{
    readonly event: string;
    readonly latestUs: number | null;
    readonly allTimeUs: number | null;
  }>;
  readonly limitation: typeof STORE_KV_STATS_SERVER_WIDE_GAP;
  readonly slowlogLimitation: typeof STORE_KV_STATS_SLOWLOG_ARGS_GAP;
  readonly masked: boolean;
  readonly namespacePrefix: string;
};

/**
 * QUERY /console/store/kv/stats — Redis-wire INFO / COMMANDSTATS / SLOWLOG.
 *
 * @param body - KV store ref + optional reveal
 */
export async function storeKvStats(
  body: StoreKvStatsInput,
): Promise<ConsoleApiResult<StoreKvStatsResult>> {
  return consoleFetch<StoreKvStatsResult>("/console/store/kv/stats", {
    method: "QUERY",
    body: JSON.stringify(body),
  });
}

/** Request body for `POST /console/store/object`. */
export type StoreFileGetInput = {
  readonly ref: string;
  readonly key: string;
  readonly tenant?: string;
};

/** Success payload from `POST /console/store/object`. */
export type StoreFileObject = {
  readonly key: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly encoding: "utf8" | "base64";
  readonly body: string;
  readonly truncated: boolean;
  readonly originalName?: string;
  readonly warnings: ReadonlyArray<{ readonly code: string; readonly message: string }>;
};

/**
 * POST /console/store/object — read one files object for preview / download.
 *
 * @param body - Store ref + object key
 */
export async function storeFileGet(
  body: StoreFileGetInput,
): Promise<ConsoleApiResult<StoreFileObject>> {
  return consoleFetch<StoreFileObject>("/console/store/object", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Resolution layer from `GET /console/vault`. */
export type VaultResolutionSource = "process.env" | ".env.local" | "driver" | "dev-fallback";

/** One vault contract from `GET /console/vault`. */
export type VaultListRow = {
  readonly name: string;
  readonly kind: "secret" | "config";
  readonly sensitive: boolean;
  readonly description?: string;
  readonly rotate?: string;
  readonly fingerprints: Readonly<Record<string, string>>;
  readonly fingerprint: string | null;
  readonly cleartext: string | null;
  readonly winner: VaultResolutionSource | null;
  readonly resolution: ReadonlyArray<{
    readonly source: VaultResolutionSource;
    readonly present: boolean;
    readonly won: boolean;
  }>;
  readonly readers: readonly string[];
  readonly blastRadius: {
    readonly count: number;
    readonly longestWakeAt: number | null;
    readonly longestOutstandingMs: number | null;
    readonly runIds: readonly string[];
  };
  readonly lastReadAt: number | null;
  readonly sharedFingerprintEnvs: readonly string[];
  readonly origin?: "source" | "console";
};

/** Built-in backend status from `GET /console/vault`. */
export type VaultBuiltinStatus = {
  readonly initialized: boolean;
  readonly sealed: boolean;
  readonly masterKeyPresent: boolean;
  readonly kekVersion: number;
  readonly secretCount: number;
  readonly sealCount: number;
  readonly lastSealedAt: number | null;
  readonly lastUnsealedAt: number | null;
  readonly rewrapTargetKekVersion: number | null;
};

/** Backend badge from `GET /console/vault`. */
export type VaultBackend = {
  readonly driverId: "env" | "vault" | "managed" | "memory";
  readonly builtin: boolean;
  readonly status: VaultBuiltinStatus | null;
  readonly unavailable: string | null;
  readonly provider: string | null;
};

/** Vault list payload (`GET /console/vault`). */
export type VaultListPayload = {
  readonly secrets: readonly VaultListRow[];
  readonly env: string;
  readonly backend: VaultBackend | null;
};

/**
 * GET /console/vault — fingerprints only; never secret values.
 */
export async function vaultList(): Promise<ConsoleApiResult<VaultListPayload>> {
  return consoleFetch<VaultListPayload>("/console/vault");
}

/** Request body for `POST /console/vault/set` and `/rotate`. */
export type VaultWriteInput = {
  readonly name: string;
  readonly value: string;
  readonly reason: string;
  readonly confirmation?: string;
};

/** Success payload from vault set / rotate. */
export type VaultWriteResult = {
  readonly ok: true;
  readonly name: string;
  readonly fingerprint: string | null;
  readonly at: string;
};

/**
 * POST /console/vault/set — write a contract value (reason required).
 *
 * @param body - Name + value + reason
 */
export async function vaultSet(body: VaultWriteInput): Promise<ConsoleApiResult<VaultWriteResult>> {
  return consoleFetch<VaultWriteResult>("/console/vault/set", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Request body for `POST /console/vault/create`. */
export type VaultCreateInput = {
  readonly name: string;
  readonly value: string;
  readonly kind: "secret" | "config";
  readonly description?: string;
  readonly rotate?: string;
};

/**
 * POST /console/vault/create — declare a contract from Console and set its value.
 *
 * @param body - Kind + name + value
 */
export async function vaultCreate(
  body: VaultCreateInput,
): Promise<ConsoleApiResult<VaultWriteResult>> {
  return consoleFetch<VaultWriteResult>("/console/vault/create", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * POST /console/vault/rotate — rotate a contract value (reason required).
 *
 * @param body - Name + value + reason
 */
export async function vaultRotate(
  body: VaultWriteInput,
): Promise<ConsoleApiResult<VaultWriteResult>> {
  return consoleFetch<VaultWriteResult>("/console/vault/rotate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Request body for `POST /console/vault/rotate-master`. */
export type VaultRotateMasterInput = {
  readonly confirmation?: string;
  readonly reason?: string;
};

/** Success payload from `POST /console/vault/rotate-master`. */
export type VaultRotateMasterResult = {
  readonly ok: true;
  readonly kekVersion: number;
  readonly remaining: number;
  readonly masterKey: string | null;
  readonly at: string;
};

/**
 * POST /console/vault/rotate-master — one KEK rewrap batch.
 *
 * @param body - Typed confirm
 */
export async function vaultRotateMaster(
  body: VaultRotateMasterInput,
): Promise<ConsoleApiResult<VaultRotateMasterResult>> {
  return consoleFetch<VaultRotateMasterResult>("/console/vault/rotate-master", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Operator-safe audit row from `GET /console/vault/audit/verify`. */
export type VaultAuditRow = {
  readonly id: string;
  readonly seq: number;
  readonly action: string;
  readonly path: string | null;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly success: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly requestId: string | null;
  readonly createdAt: number;
};

/** Success payload from `GET /console/vault/audit/verify`. */
export type VaultAuditVerifyResult = {
  readonly ok: boolean;
  readonly brokenAt: string | null;
  readonly reason: "link" | "payload" | null;
  readonly row: VaultAuditRow | null;
};

/**
 * GET /console/vault/audit/verify — walk the hash chain (sealed).
 */
export async function vaultAuditVerify(): Promise<ConsoleApiResult<VaultAuditVerifyResult>> {
  return consoleFetch<VaultAuditVerifyResult>("/console/vault/audit/verify");
}

/** One Access API key row (`GET /console/access`). */
export type AccessKeyRow = {
  readonly id: string;
  readonly name: string;
  readonly plane: "user" | "operator";
  readonly scopes: readonly string[];
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
  readonly expiresAt: number | null;
  readonly revokedAt: number | null;
  readonly rateLimit: { max: number; per: string } | null;
  readonly ipAllowlist: readonly string[];
  readonly unused90d: boolean;
};

/** One Access user row. */
export type AccessUserRow = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: "active" | "disabled";
  readonly roles: readonly string[];
  readonly scopes: readonly string[];
};

/** Access plane section. */
export type AccessPlaneSection = {
  readonly keys: readonly AccessKeyRow[];
  readonly users?: readonly AccessUserRow[];
  readonly grantableScopes: readonly string[];
};

/** Access list payload (`GET /console/access`). */
export type AccessListPayload = {
  readonly operatorPlane: AccessPlaneSection;
  readonly userPlane: AccessPlaneSection;
  readonly catalog: readonly string[];
  readonly accessTtlMs: number;
};

/**
 * GET /console/access — keys, users, grantable scopes.
 */
export async function accessList(): Promise<ConsoleApiResult<AccessListPayload>> {
  return consoleFetch<AccessListPayload>("/console/access");
}

/** Blast radius for one key. */
export type AccessKeyBlastPayload = {
  readonly callVolume: number;
  readonly lastUsedAt: number | null;
  readonly sourceAddresses: readonly string[];
  readonly accessTtlMs: number;
  readonly residualAccessNote: string;
};

/**
 * POST /console/access/key-blast — usage from Runs.
 *
 * @param keyId - Key id
 */
export async function accessKeyBlast(
  keyId: string,
): Promise<ConsoleApiResult<AccessKeyBlastPayload>> {
  return consoleFetch<AccessKeyBlastPayload>("/console/access/key-blast", {
    method: "POST",
    body: JSON.stringify({ keyId }),
  });
}

/** Create-key request. */
export type AccessCreateKeyInput = {
  readonly plane: "user" | "operator";
  readonly name: string;
  readonly scopes: readonly string[];
  readonly creatorUserId?: string;
  readonly expiresAt?: number | null;
  readonly rateLimit?: { max: number; per: string } | null;
  readonly ipAllowlist?: readonly string[];
};

/** Create / rotate success — secret once. */
export type AccessSecretOnceResult = {
  readonly key: AccessKeyRow;
  readonly secret: string;
};

/**
 * POST /console/access/keys — mint an attenuated key (secret once).
 *
 * @param body - Create payload
 */
export async function accessCreateKey(
  body: AccessCreateKeyInput,
): Promise<ConsoleApiResult<AccessSecretOnceResult>> {
  return consoleFetch<AccessSecretOnceResult>("/console/access/keys", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * POST /console/access/keys/rotate — new secret once.
 *
 * @param body - Key id + ROTATE confirm
 */
export async function accessRotateKey(body: {
  readonly keyId: string;
  readonly confirmation: "ROTATE";
  readonly reason: string;
}): Promise<ConsoleApiResult<AccessSecretOnceResult>> {
  return consoleFetch<AccessSecretOnceResult>("/console/access/keys/rotate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * POST /console/access/keys/revoke — irreversible.
 *
 * @param body - Key id + REVOKE confirm
 */
export async function accessRevokeKey(body: {
  readonly keyId: string;
  readonly confirmation: "REVOKE";
  readonly reason: string;
}): Promise<ConsoleApiResult<{ readonly key: AccessKeyRow }>> {
  return consoleFetch<{ readonly key: AccessKeyRow }>("/console/access/keys/revoke", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * POST /console/access/keys/update — metadata + scopes.
 *
 * @param body - Patch
 */
export async function accessUpdateKey(body: {
  readonly keyId: string;
  readonly name?: string;
  readonly scopes?: readonly string[];
  readonly expiresAt?: number | null;
  readonly rateLimit?: { max: number; per: string } | null;
  readonly ipAllowlist?: readonly string[];
}): Promise<ConsoleApiResult<{ readonly key: AccessKeyRow }>> {
  return consoleFetch<{ readonly key: AccessKeyRow }>("/console/access/keys/update", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
