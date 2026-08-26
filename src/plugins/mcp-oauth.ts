/**
 * `mcpOauth` — hand-rolled OAuth 2.1 Authorization Server plugin for MCP.
 *
 * This is the ISSUER track, separate from the `oauth()` RP plugin (which
 * consumes other IdPs for social sign-in). They share identity tables via
 * gate.auth; they do not share token formats or endpoints.
 *
 * Locked decisions implemented here:
 * - CIMD only (client_id is a metadata-document URL; no DCR)
 * - DPoP required on every token grant (`cnf.jkt` on issued tokens)
 * - RFC 8707 `resource` required on every authorize/token request,
 *   matched against the canonical resource URI
 * - Exact redirect_uri matching from fetched client metadata
 * - Consent is a JSON Flow contract the app's own UI renders;
 *   Console gets read-only audit only
 *
 * The AS crypto/JWKS module is dynamically imported at `.plug()` time so
 * Store-only / non-MCP apps never pay for it (zero-cost when unplugged).
 */

import { field } from "../elements/store/schema-decl.ts";
import { plugin, type PluginDef } from "../kernel/plugin.ts";

/**
 * Options for {@link mcpOauth}.
 */
export interface McpOauthOptions {
  /** Issuer origin (e.g. `https://api.example.com`). */
  readonly issuer: string;
  /**
   * Canonical RFC 8707 resource URI clients must request (the MCP RS
   * origin/path). Every authorize/token request must match exactly.
   */
  readonly resource: string;
  /** Refresh-token TTL (default 14 days). */
  readonly refreshTtlMs?: number;
  /** App consent screen path (default `/oauth/consent`). */
  readonly consentPath?: string;
  /** Injectable clock. */
  readonly now?: () => number;
  /** Injectable CIMD document fetch (tests / mock IdP). */
  readonly fetchDoc?: (url: string) => Promise<unknown>;
}

/**
 * Define the Authorization Server plugin.
 *
 * The plugin contributes the six `oke_oauth_*` tables and an edge handler
 * serving: `/.well-known/oauth-authorization-server`,
 * `/.well-known/oauth-protected-resource`, `/oauth/authorize`,
 * `/oauth/token`, `/oauth/jwks`.
 *
 * Consent Flows are created with {@link mcpOauthConsentFlows} — bind them
 * with session gates so the app's own consent screen can drive them over
 * JSON; the framework never ships end-user HTML.
 *
 * @param options - Issuer/resource identity plus injectables
 */
export function mcpOauth(options: McpOauthOptions): PluginDef {
  // Lazy: a static import would pin ES256/DPoP code on every app bundle.
  const runtimePromise = import("../auth/oauth-as/http.ts").then((mod) =>
    mod.createOauthAs({
      issuer: options.issuer,
      resource: options.resource,
      stores: mod.createAsStores(),
      ...(options.refreshTtlMs !== undefined ? { refreshTtlMs: options.refreshTtlMs } : {}),
      ...(options.now !== undefined ? { now: options.now } : {}),
      ...(options.fetchDoc !== undefined ? { fetchDoc: options.fetchDoc } : {}),
      ...(options.consentPath !== undefined ? { consentPath: options.consentPath } : {}),
    }),
  );

  const def = plugin("mcpOauth", {
    version: "0.0.1",
    config: { issuer: options.issuer, resource: options.resource },
  })
    .table("oke_oauth_signing_keys", signingKeyColumns(), { plane: "user" })
    .table("oke_oauth_client_cache", cimdColumns(), { plane: "user" })
    .table("oke_oauth_auth_codes", authCodeColumns(), { plane: "user" })
    .table("oke_oauth_access_tokens", accessTokenColumns(), { plane: "user" })
    .table("oke_oauth_refresh_tokens", refreshTokenColumns(), { plane: "user" })
    .table("oke_oauth_consents", consentColumns(), {
      plane: "user",
      description: "OAuth consents — audit source for Console",
    })
    .edge((request, info) => runtimePromise.then((rt) => rt.edge(request, info)));

  return def;
}

/**
 * Create the three consent JSON Flows (`view` / `approve` / `deny`) against
 * a resolved AS facade. The developer's SPA calls these over HTTP; each
 * returns plain JSON — never HTML.
 *
 * @param facade - Resolved facade from {@link mcpOauth}'s lazy module
 *   (`await import("okengine/auth/oauth-as/http").then(m => m.createOauthAs(...))`)
 * @param userId - The signed-in gate.auth user id (session-gated Flow input)
 */
export function mcpOauthConsentFlows(facade: {
  describeConsent(pendingId: string): {
    clientId: string;
    clientName: string | null;
    scope: readonly string[];
    resource: string;
  };
  approveConsent(pendingId: string, userId: string): Promise<{ redirectTo: string }>;
  denyConsent(pendingId: string, userId: string): { redirectTo: string };
}) {
  const view = async (input: { pendingId: string }) => facade.describeConsent(input.pendingId);
  const approve = async (input: { pendingId: string; userId: string }) =>
    facade.approveConsent(input.pendingId, input.userId);
  const deny = async (input: { pendingId: string; userId: string }) =>
    facade.denyConsent(input.pendingId, input.userId);
  return { view, approve, deny };
}

/* ------------------------------------------------------------------ */
/* Column declarations (field.* builders)                              */
/* ------------------------------------------------------------------ */

/** Column shape of `oke_oauth_signing_keys`. */
function signingKeyColumns() {
  return {
    kid: field.text().primaryKey(),
    alg: field.text().notNull(),
    public_jwk: field.text().notNull(),
    private_key: field.text().notNull(),
    active: field.integer().notNull(),
    created_at: field.integer().notNull(),
    rotated_at: field.integer(),
  };
}

/** Column shape of `oke_oauth_client_cache`. */
function cimdColumns() {
  return {
    client_id: field.text().primaryKey(),
    metadata: field.text().notNull(),
    fetched_at: field.integer().notNull(),
    denied_at: field.integer(),
  };
}

/** Column shape of `oke_oauth_auth_codes`. */
function authCodeColumns() {
  return {
    id: field.text().primaryKey(),
    code_hash: field.text().notNull(),
    user_id: field.text().notNull(),
    client_id: field.text().notNull(),
    redirect_uri: field.text().notNull(),
    resource: field.text().notNull(),
    scope: field.text().notNull(),
    code_challenge: field.text().notNull(),
    code_challenge_method: field.text().notNull(),
    jkt: field.text(),
    expires_at: field.integer().notNull(),
    consumed_at: field.integer(),
    created_at: field.integer().notNull(),
  };
}

/** Column shape of `oke_oauth_access_tokens`. */
function accessTokenColumns() {
  return {
    jti: field.text().primaryKey(),
    user_id: field.text().notNull(),
    client_id: field.text().notNull(),
    resource: field.text().notNull(),
    scope: field.text().notNull(),
    jkt: field.text(),
    expires_at: field.integer().notNull(),
    revoked_at: field.integer(),
    created_at: field.integer().notNull(),
  };
}

/** Column shape of `oke_oauth_refresh_tokens`. */
function refreshTokenColumns() {
  return {
    id: field.text().primaryKey(),
    family_id: field.text().notNull(),
    user_id: field.text().notNull(),
    client_id: field.text().notNull(),
    resource: field.text().notNull(),
    scope: field.text().notNull(),
    jkt: field.text(),
    hash: field.text().notNull(),
    expires_at: field.integer().notNull(),
    used_at: field.integer(),
    revoked_at: field.integer(),
  };
}

/** Column shape of `oke_oauth_consents`. */
function consentColumns() {
  return {
    user_id: field.text().notNull(),
    client_id: field.text().notNull(),
    client_name: field.text(),
    resource: field.text().notNull(),
    scope: field.text().notNull(),
    granted_at: field.integer().notNull(),
    updated_at: field.integer().notNull(),
    revoked_at: field.integer(),
  };
}
