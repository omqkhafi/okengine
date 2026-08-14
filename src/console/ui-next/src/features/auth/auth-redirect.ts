/**
 * Post-auth return path — keep the operator on the module they were in
 * after a session expires, instead of always landing on `/overview`.
 *
 * Only `/overview`, `/flows`, `/store`, and `/vault` (plus their search) are legal.
 * Legacy `/units` rewrites to `/flows`. Anything else is dropped so `?next=`
 * cannot be an open redirect.
 */

import { validateFlowsSearch, type FlowsSearch } from "../flows/state/flows-selection.ts";
import { validateStoreSearch, type StoreSearch } from "../store/state/store-selection.ts";
import { validateUnitsSearch, type UnitsSearch } from "../units/state/units-selection.ts";
import { validateVaultSearch, type VaultSearch } from "../vault/state/vault-selection.ts";

/** Default shell module when no safe return path is present. */
export const DEFAULT_AFTER_AUTH = "/overview" as const;

/** Shell pathnames that may be restored after login. */
const SHELL_PATHS = new Set(["/overview", "/flows", "/store", "/vault"]);

/** Upper bound so a crafted `next` cannot bloat the login URL. */
const MAX_RETURN_TO_LENGTH = 1024;

/** Search on the pre-auth gate (`/`). */
export type AuthSearch = {
  readonly next?: string;
};

/** Typed shell location used by `navigate` after claim / login. */
export type AfterAuthLocation =
  | { readonly to: "/overview"; readonly search: FlowsSearch }
  | { readonly to: "/flows"; readonly search: UnitsSearch }
  | { readonly to: "/store"; readonly search: StoreSearch }
  | { readonly to: "/vault"; readonly search: VaultSearch };

/**
 * Keep only an in-console shell href (`/overview` | `/flows` | `/store` | `/vault` + search).
 * `/units` is rewritten to `/flows`.
 *
 * @param value - Raw `next` search param or `pathname + search`
 */
export function sanitizeReturnTo(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_RETURN_TO_LENGTH) return undefined;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("://")) {
    return undefined;
  }

  let pathname: string;
  let search: string;
  try {
    const url = new URL(trimmed, "http://console.local");
    if (url.origin !== "http://console.local") return undefined;
    pathname = url.pathname === "/units" ? "/flows" : url.pathname;
    search = url.search;
  } catch {
    return undefined;
  }

  if (!SHELL_PATHS.has(pathname)) return undefined;
  return search.length > 0 ? `${pathname}${search}` : pathname;
}

/**
 * Validate `/` search — drop an unsafe or default `next`.
 *
 * @param search - Raw router search object
 */
export function validateAuthSearch(search: Record<string, unknown>): AuthSearch {
  const next = sanitizeReturnTo(search.next);
  if (next === undefined || next === DEFAULT_AFTER_AUTH) return {};
  return { next };
}

/**
 * Search to attach when sending an expired session to the login gate.
 * Omits `next` when the return path is missing or is already `/overview`.
 *
 * @param returnTo - Current `pathname + searchStr`
 */
export function authGateSearch(returnTo: string): AuthSearch {
  return validateAuthSearch({ next: returnTo });
}

/**
 * Parse a return path into a typed shell navigation target.
 *
 * @param value - Raw `next` or sanitized href
 */
export function afterAuthLocation(value: unknown): AfterAuthLocation {
  const next = sanitizeReturnTo(value);
  if (next === undefined) return { to: DEFAULT_AFTER_AUTH, search: {} };
  const url = new URL(next, "http://console.local");
  const raw = Object.fromEntries(url.searchParams.entries());
  if (url.pathname === "/flows") {
    return { to: "/flows", search: validateUnitsSearch(raw) };
  }
  if (url.pathname === "/store") {
    return { to: "/store", search: validateStoreSearch(raw) };
  }
  if (url.pathname === "/vault") {
    return { to: "/vault", search: validateVaultSearch(raw) };
  }
  return { to: "/overview", search: validateFlowsSearch(raw) };
}

/** `navigate` surface used after claim / login (avoids a `to` union). */
export type AfterAuthNavigate = {
  (opts: { to: "/overview"; search: FlowsSearch }): unknown;
  (opts: { to: "/flows"; search: UnitsSearch }): unknown;
  (opts: { to: "/store"; search: StoreSearch }): unknown;
  (opts: { to: "/vault"; search: VaultSearch }): unknown;
};

/**
 * Navigate into the shell, honoring a safe `next` when present.
 *
 * @param navigate - Router `navigate`
 * @param value - Raw `next` search param
 */
export function goAfterAuth(navigate: AfterAuthNavigate, value: unknown): void {
  const dest = afterAuthLocation(value);
  switch (dest.to) {
    case "/flows":
      void navigate({ to: "/flows", search: dest.search });
      return;
    case "/store":
      void navigate({ to: "/store", search: dest.search });
      return;
    case "/vault":
      void navigate({ to: "/vault", search: dest.search });
      return;
    default:
      void navigate({ to: "/overview", search: dest.search });
  }
}
