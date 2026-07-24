/**
 * Console UI client — `createClient` against the ConsoleApp on :6533.
 */

import { createClient } from "../../../client/create.ts";

/** Session tokens held in memory (cookies are HttpOnly / SameSite=Strict). */
let accessToken: string | null = null;

/**
 * Store the operator access token after claim/login.
 *
 * @param token - Access token or null to clear
 */
export function setAccessToken(token: string | null): void {
  accessToken = token;
  if (token) {
    sessionStorage.setItem("oke_console_at", token);
  } else {
    sessionStorage.removeItem("oke_console_at");
  }
}

/**
 * Restore token from sessionStorage (tab lifetime).
 */
export function restoreAccessToken(): void {
  accessToken = sessionStorage.getItem("oke_console_at");
}

/** Loose result shape from Console REST calls. */
type CallResult<T> = Promise<{
  data: T | null;
  error: { code: string } | null;
}>;

/** Console client surface used by the shell (keeps UI free of App import). */
interface ConsoleClient {
  readonly console: {
    setupStatus: (input: Record<string, never>) => CallResult<{
      setupClosed: boolean;
      claimRequired: boolean;
    }>;
    setupClaim: (input: {
      claimCode: string;
      email: string;
      name: string;
      password: string;
    }) => CallResult<{
      accessToken: string;
      refreshToken: string;
      operatorId: string;
      email: string;
      name: string;
    }>;
    sessionLogin: (input: {
      email: string;
      password: string;
    }) => CallResult<{
      accessToken: string;
      refreshToken: string;
      operatorId: string;
      email: string;
      name: string;
    }>;
    sessionMe: (input: Record<string, never>) => CallResult<{
      operatorId: string;
      email: string;
      name: string;
      setupClosed: boolean;
    }>;
    sessionLogout: (input: Record<string, never>) => CallResult<{ ok: true }>;
    manifestGet: (input: Record<string, never>) => CallResult<{
      manifest: unknown;
    }>;
    runsList: (input: Record<string, never>) => CallResult<{
      runs: Array<{
        id: string;
        flow: string;
        startedAt: number;
      }>;
    }>;
    actionPing: (input: { note?: string }) => CallResult<{
      ok: true;
      note?: string;
      at: number;
    }>;
    flowsIdentities: (input: Record<string, never>) => CallResult<{
      identities: Array<{
        id: string;
        email: string;
        name: string;
        status: string;
        scopes: string[];
      }>;
    }>;
    flowsInvoke: (input: {
      flowId: string;
      body: unknown;
      asUserId: string;
      confirmation?: string;
      reason?: string;
    }) => CallResult<{
      ok: true;
      flowId: string;
      asUserId: string;
      trigger: string;
      response: unknown;
      peakTier: string;
      auditedAt: number;
    }>;
  };
}

/** Typed Console API (REST from `/_oke/client.json` at runtime). */
export const consoleApi = createClient(
  typeof globalThis.location !== "undefined"
    ? globalThis.location.origin
    : "http://127.0.0.1:6533",
  {
    headers: () =>
      (accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : {}) as Record<string, string>,
    routes: {
      "console.setupStatus": { method: "GET", path: "/console/setup/status" },
      "console.setupClaim": { method: "POST", path: "/console/setup/claim" },
      "console.sessionLogin": { method: "POST", path: "/console/session/login" },
      "console.sessionMe": { method: "GET", path: "/console/session/me" },
      "console.sessionLogout": { method: "POST", path: "/console/session/logout" },
      "console.manifestGet": { method: "GET", path: "/console/manifest" },
      "console.runsList": { method: "GET", path: "/console/runs" },
      "console.actionPing": { method: "POST", path: "/console/action/ping" },
      "console.structuralPropose": {
        method: "POST",
        path: "/console/structural/propose",
      },
      "console.flowsIdentities": {
        method: "GET",
        path: "/console/flows/identities",
      },
      "console.flowsInvoke": {
        method: "POST",
        path: "/console/flows/invoke",
      },
    },
  },
) as unknown as ConsoleClient;

/** Loose call helpers used by the shell (keeps UI free of App type import). */
export const consoleCalls = {
  /**
   * Setup wizard status.
   */
  async setupStatus() {
    return consoleApi.console.setupStatus({});
  },
  /**
   * Claim first admin.
   *
   * @param body - Claim payload
   */
  async setupClaim(body: {
    claimCode: string;
    email: string;
    name: string;
    password: string;
  }) {
    return consoleApi.console.setupClaim(body);
  },
  /**
   * Operator login.
   *
   * @param body - Credentials
   */
  async sessionLogin(body: { email: string; password: string }) {
    return consoleApi.console.sessionLogin(body);
  },
  /**
   * Current operator.
   */
  async sessionMe() {
    return consoleApi.console.sessionMe({});
  },
  /**
   * Audited ping action.
   *
   * @param note - Optional note
   */
  async actionPing(note?: string) {
    return consoleApi.console.actionPing({ note });
  },
  /**
   * List runs / traces.
   */
  async runsList() {
    return consoleApi.console.runsList({});
  },
  /**
   * Manifest snapshot for the causality view.
   */
  async manifestGet() {
    return consoleApi.console.manifestGet({});
  },
  /**
   * Identities for the invoke-as picker.
   */
  async flowsIdentities() {
    return consoleApi.console.flowsIdentities({});
  },
  /**
   * Invoke a flow as a user-plane identity.
   *
   * @param body - Invoke payload
   */
  async flowsInvoke(body: {
    flowId: string;
    body: unknown;
    asUserId: string;
    confirmation?: string;
    reason?: string;
  }) {
    return consoleApi.console.flowsInvoke(body);
  },
};
