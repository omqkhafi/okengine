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

/**
 * Store the operator access token after a successful claim or login.
 *
 * @param token - Access token or null to clear
 */
export function setAccessToken(token: string | null): void {
  accessToken = token;
  if (token) {
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
  return (await res.json()) as ConsoleApiResult<T>;
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
  readonly sampled: "full" | "error" | "sample" | "boost";
  readonly effects: readonly RunEffect[];
  readonly logs: readonly RunLog[];
  readonly dimensions: Record<string, string | number | boolean | null>;
  /**
   * Validated flow input snapshot (powers replay). `null` when the run has
   * no stored input — never invent a response/output field.
   */
  readonly input: unknown;
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
