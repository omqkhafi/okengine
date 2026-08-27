/**
 * OAuth plugin shared surface: options, provider ids, PKCE minting.
 * Backend-only — never imported by Console UI.
 */

import type { VerificationStore } from "../../auth/verification.ts";
import type { SessionStore } from "../../auth/sessions.ts";
import { generateCodeVerifier, codeChallengeS256 } from "../../drivers/oauth-shared.ts";
import type { OAuthDriverId } from "../../drivers/oauth-types.ts";
import type { AnyFlowDef } from "../../kernel/flow.ts";
import { bindAuthHttp } from "../../auth/bindings.ts";
import { http } from "../auth/shared.ts";
import type { Binding } from "../../kernel/on.ts";

/** Every supported social provider. */
export const OAUTH_PROVIDER_IDS = [
  "google",
  "apple",
  "microsoft",
  "github",
  "discord",
  "x",
  "facebook",
  "figma",
] as const;

/** Supported social providers (same set as {@link OAuthDriverId}). */
export type OAuthProviderId = OAuthDriverId;

/** Per-provider plugin configuration. */
export interface OAuthProviderConfig {
  /** Enable this provider (default `false`). */
  readonly enabled?: boolean;
  /**
   * Confidential client id. Public information — inline config is fine;
   * `OAUTH_<PROVIDER>_CLIENT_ID` via Vault/env also resolves at boot.
   */
  readonly clientId?: string;
  /**
   * EXACT redirect URI string registered at the provider console. Compared
   * byte-for-byte — never derived from the request. Defaults to
   * `${baseUrl}/auth/oauth/callback/{provider}`.
   */
  readonly redirectUri?: string;
  /** Scopes requested at the provider (driver defaults apply when omitted). */
  readonly scopes?: readonly string[];
  /** Opt-in storage of provider tokens in Vault (encrypted), default off. */
  readonly storeProviderTokens?: boolean;
  /** Microsoft only — tenant selector or GUID (default `common`). */
  readonly tenant?: "common" | "organizations" | "consumers" | string;
  /** Apple only — Developer team id (client-secret JWT `iss`). */
  readonly teamId?: string;
  /** Apple only — Sign in with Apple private-key id (`kid`). */
  readonly keyId?: string;
}

/** Options for the {@link oauth} plugin factory. */
export interface OAuthOptions {
  /** Per-provider configuration; providers default to disabled. */
  readonly providers?: Readonly<Partial<Record<OAuthProviderId, OAuthProviderConfig>>>;
  /**
   * Default app origin used to synthesize per-provider callback redirect
   * URIs (`{baseUrl}/auth/oauth/callback/{provider}`).
   */
  readonly baseUrl?: string;
  /** HMAC secret; falls back to the active `gate.auth` secret like other methods. */
  readonly secret?: string;
  /** Shared session store (prefer the same store as `gate.auth`). */
  readonly sessions?: SessionStore;
  /** Shared identity/credential store (defaults to `gate.auth.identities`). */
  readonly identities?: import("../../auth/identity.ts").IdentityStore;
  /** Shared verification store backing OAuth flow rows (tests / advanced). */
  readonly verifications?: VerificationStore;
  /** Injectable clock. */
  readonly now?: () => number;
  /** Injectable fetch for every driver (tests — mock IdP). */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Fresh PKCE pair for a new authorization-code flow (RFC 7636 S256).
 */
export async function mintPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = generateCodeVerifier();
  return { verifier, challenge: await codeChallengeS256(verifier) };
}

/**
 * Bind an auth Flow to a public **GET** trigger — provider redirects carry
 * `?code=&state=`. The POST twin (Apple form_post) is bound separately.
 *
 * @param path - Absolute route path
 * @param flowDef - Flow to bind
 * @param gates - Optional gate decls (rate limiting)
 */
export function bindPublicAuthGet(
  path: string,
  flowDef: AnyFlowDef,
  gates: readonly Parameters<ReturnType<typeof http.get>["gate"]>[0][] = [],
): Binding {
  return bindAuthHttp(
    http
      .get(path)
      .public()
      .gate(...gates),
    flowDef,
  );
}
