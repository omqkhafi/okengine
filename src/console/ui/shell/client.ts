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
  },
},
);

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
};
