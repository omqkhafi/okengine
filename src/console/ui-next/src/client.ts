/**
 * Thin Console client for ui-next — setup + session login against the real kernel.
 * Same-origin `/console/*` (no mocks).
 */

/** Session access token key (matches current Console SPA). */
export const ACCESS_TOKEN_KEY = "oke_console_at";

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
export async function setupClaim(
  body: SetupClaimInput,
): Promise<ConsoleApiResult<SessionOut>> {
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
export async function sessionLogin(
  body: SessionLoginInput,
): Promise<ConsoleApiResult<SessionOut>> {
  return consoleFetch<SessionOut>("/console/session/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
