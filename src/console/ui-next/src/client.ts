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
  readonly at: number;
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
  readonly asUserId: string;
  readonly pathParams?: Readonly<Record<string, string>>;
  readonly confirmation?: string;
  readonly reason?: string;
};

/** Success payload from `POST /console/flows/invoke`. */
export type FlowsInvokeResult = {
  readonly ok: true;
  readonly flowId: string;
  readonly asUserId: string;
  readonly trigger: string;
  readonly response: unknown;
  readonly status?: number;
  readonly failure?: {
    readonly code: string;
    readonly data?: unknown;
    readonly message?: string;
  };
  readonly runId?: string;
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
  readonly at: number;
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
  readonly topK?: number;
  /** When true, SQL browse returns PII cleartext (audited). Default masks. */
  readonly revealPii?: boolean;
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
    readonly warnings?: ReadonlyArray<{ readonly code: string; readonly message: string }>;
  }>;
  readonly hits?: ReadonlyArray<{
    readonly id: string;
    readonly score: number;
    readonly meta?: Readonly<Record<string, unknown>>;
  }>;
  readonly masked: boolean;
  readonly routedRole?: "primary" | "replica";
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
  readonly at: number;
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
  readonly at: number;
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
  readonly at: number;
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
};

/** Success payload from `POST /console/store/sql` (matches server `StoreSqlOut`). */
export type StoreSqlResult = {
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly masked: boolean;
  readonly routedRole: "primary" | "replica";
  readonly asGate: string | null;
  readonly gateApplied: boolean;
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
