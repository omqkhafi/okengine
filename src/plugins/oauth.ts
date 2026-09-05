/**
 * OAuth social-login plugin — Authorization Code + PKCE for eight providers,
 * routed through `linkOrProvision` with the per-provider email trust matrix.
 *
 * Security posture (locked decisions):
 * - PKCE S256 mandatory; implicit / ROPC never implemented
 * - Single-use `state` rows (SHA-256-hashed at rest) on the verification store
 * - Mix-up defense (RFC 9700 §4.4 / RFC 9207): flow records pin the initiated
 *   issuer; callbacks verify route provider == stored provider and, for OIDC,
 *   ID token `iss` == stored expectation (Microsoft `{tenantid}` template via
 *   concrete per-tenant regex)
 * - Exact registered redirect URIs — never derived from the request
 * - Unverified emails cannot take over existing accounts (`linkOrProvision`
 *   refuses `email_in_use` without an authenticated `currentUserId`)
 * - Provider tokens are NOT stored unless `storeProviderTokens`; then only in
 *   Vault behind envelope sealing
 */

import { z } from "zod";
import {
  authPublicGates,
  bindPublicAuth,
  bindSessionAuth,
  createMethodRuntime,
  fail,
  flow,
  http,
  resolveSharedIdentities,
} from "./auth/shared.ts";
import { bindAuthHttp } from "../auth/bindings.ts";
import { hashChallenge } from "../auth/verification.ts";
import { issueSessionWithScopes } from "../auth/sessions.ts";
import type { Binding } from "../kernel/on.ts";
import type { Fx } from "../kernel/fx.ts";
import type { AnyFlowDef } from "../kernel/flow.ts";
import { identityFailureReason, oauthLink } from "./oauth/link.ts";
import {
  consumeOauthFlow,
  createOAuthFlowStore,
  findOauthFlow,
  putOauthFlow,
} from "./oauth/flow-store.ts";
import {
  mintPkcePair,
  OAUTH_PROVIDER_IDS,
  bindPublicAuthGet,
  type OAuthOptions,
  type OAuthProviderConfig,
  type OAuthProviderId,
} from "./oauth/shared.ts";
import { sealTokenEnvelope, unsealTokenEnvelope } from "./oauth/token-vault.ts";
import { generateState } from "../drivers/oauth-shared.ts";
import type { OAuthDriver, OAuthTokenSet } from "../drivers/oauth-types.ts";
import { openOAuthGoogle } from "../drivers/oauth-google.ts";
import { openOAuthApple } from "../drivers/oauth-apple.ts";
import { openOAuthMicrosoft } from "../drivers/oauth-microsoft.ts";
import { openOAuthGithub } from "../drivers/oauth-github.ts";
import { openOAuthDiscord } from "../drivers/oauth-discord.ts";
import { openOAuthX } from "../drivers/oauth-x.ts";
import { openOAuthFacebook } from "../drivers/oauth-facebook.ts";
import { openOAuthFigma } from "../drivers/oauth-figma.ts";
import { createAppleClientSecretJwt } from "../drivers/oauth-oidc.ts";
import { vault } from "../elements/vault.ts";
import { plugin } from "../kernel/plugin.ts";

export { OAUTH_PROVIDER_IDS };
export type { OAuthOptions, OAuthProviderConfig, OAuthProviderId };

const PROVIDER_ENUM = z.enum(OAUTH_PROVIDER_IDS);

/** Output of the start / link-start Flows. */
const StartOut = z.object({
  provider: PROVIDER_ENUM,
  authorizationUrl: z.string(),
  expiresInMs: z.number(),
});

/** Session payload issued on a successful callback. */
const SessionTokensOut = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: z.number(),
  userId: z.string(),
});

const AuthFailed = z.object({ reason: z.string().optional() });
const AuthRateLimited = z.object({ reason: z.string() });

const StartIn = z.object({ provider: PROVIDER_ENUM });

const CallbackIn = z.object({
  provider: PROVIDER_ENUM,
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  /** Apple `response_mode=form_post` delivers urlencoded bodies here. */
  body: z.unknown().optional(),
});

/** Resolved per-provider runtime bundle. */
interface ProviderRuntime {
  readonly id: OAuthProviderId;
  readonly driver: OAuthDriver;
  readonly config: OAuthProviderConfig;
}

/**
 * Social login plugin. Enable `gate.auth`, configure providers, then
 * `.plug(oauth({...}))`.
 *
 * @param options - Provider configs, base URL, optional shared stores/fetch
 */
export function oauth(options: OAuthOptions = {}) {
  const runtime = createMethodRuntime(options);
  const identities = resolveSharedIdentities(options);
  const verifications = createOAuthFlowStore(options.verifications);
  const now: () => number = () => runtime.now();
  const providers = buildProviders(options);

  const start = flow("auth.oauthStart", {
    plane: "user",
    in: StartIn,
    out: StartOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      const p = providers.find((c) => c.id === input.provider);
      if (!p) return fail("AuthFailed", { reason: "provider_disabled" });
      const redirectUri = resolveRedirectUri(p, options);
      const clientId = p.config.clientId;
      if (!redirectUri || !clientId) {
        return fail("AuthFailed", { reason: "provider_misconfigured" });
      }
      const state = generateState();
      const { verifier, challenge } = await mintPkcePair();
      const nonce = p.driver.kind === "oidc" ? generateState() : undefined;
      await putOauthFlow(
        verifications,
        {
          provider: p.id,
          stateHash: await hashChallenge(state),
          codeVerifier: verifier,
          redirectUri,
          ...(nonce !== undefined ? { nonce } : {}),
          expectedIssuer: p.driver.authorizationServerId,
          clientId,
        },
        now(),
      );
      return {
        provider: p.id,
        authorizationUrl: p.driver.buildAuthorizeUrl({
          clientId,
          redirectUri,
          scopes: p.config.scopes ?? [],
          state,
          codeChallenge: challenge,
          ...(nonce !== undefined ? { nonce } : {}),
        }).url,
        expiresInMs: OAUTH_FLOW_TTL_MS,
      };
    },
  });

  const callback = flow("auth.oauthCallback", {
    plane: "user",
    in: CallbackIn,
    out: SessionTokensOut,
    errors: { AuthFailed, AuthRateLimited },
    effects: { secrets: callbackSecretRefs(providers) },
    do: async (input, fx) => {
      if (typeof input.error === "string" && input.error.length > 0) {
        return fail("AuthFailed", { reason: "authorization_failed" });
      }
      const code = input.code ?? fieldFromBody(input.body, "code");
      const state = input.state ?? fieldFromBody(input.body, "state");
      if (!code || !state) return fail("AuthFailed", { reason: "invalid_callback" });
      const t = now();

      // Mix-up defense layer 1 — rows are keyed `oauth:{provider}:{hash}`,
      // so a state minted for another provider never matches this route.
      const record = await findOauthFlow(verifications, input.provider, state, t);
      if (!record || record.provider !== input.provider) {
        return fail("AuthFailed", { reason: "invalid_state" });
      }
      await consumeOauthFlow(verifications, input.provider, state, t);

      const p = providers.find((c) => c.id === record.provider);
      if (!p) return fail("AuthFailed", { reason: "invalid_state" });

      let credentials: Awaited<ReturnType<typeof loadCredentials>>;
      try {
        credentials = await loadCredentials(p, fx);
      } catch (err) {
        return fail("AuthFailed", { reason: credentialFailureReason(err) });
      }

      // Protocol phase — exchange + assertion. Any failure here is the
      // provider's or an attacker's; nothing has touched identity state.
      let assertion;
      let exchangedTokens: OAuthTokenSet | undefined;
      try {
        const exchanged = await p.driver.exchangeCode({
          clientId: record.clientId,
          redirectUri: record.redirectUri,
          code,
          codeVerifier: record.codeVerifier,
          ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
          ...credentials,
        });
        exchangedTokens = exchanged.tokens;
        // Mix-up defense layer 2 — drivers verify ID-token `iss` against the
        // flow-record expectation; OAuth2 assertions carry the pinned AS id.
        assertion = await p.driver.resolveAssertion({
          tokens: exchanged.tokens,
          expectedIssuer: record.expectedIssuer,
          expectedAudience: record.clientId,
          ...(record.nonce !== undefined ? { expectedNonce: record.nonce } : {}),
        });
      } catch (err) {
        return fail("AuthFailed", { reason: protocolReason(err) });
      }
      if (assertion.issuer !== record.expectedIssuer) {
        return fail("AuthFailed", { reason: "issuer_mismatch" });
      }

      // Identity phase — the ONLY path identities are ever written from.
      let linked;
      try {
        linked = await oauthLink(identities, p.id, assertion, record.currentUserId);
      } catch (err) {
        const reason = identityFailureReason(err);
        if (reason === undefined) throw err;
        return fail("AuthFailed", { reason });
      }

      if (p.config.storeProviderTokens === true && exchangedTokens !== undefined) {
        await persistProviderTokens(
          p.id,
          linked.userId,
          exchangedTokens,
          runtime.crypto.secret,
          fx,
        );
      }
      const issued = await issueSessionWithScopes(runtime.sessions, runtime.crypto, {
        id: linked.userId,
        plane: "user",
        scopes: [],
      });
      return {
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        accessExpiresAt: issued.accessExpiresAt,
        userId: linked.userId,
      };
    },
  });

  const linkStart = flow("auth.oauthLinkStart", {
    plane: "user",
    in: StartIn,
    out: StartOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async (input, fx) => {
      const currentUserId = fx.auth.userId;
      if (!currentUserId) return fail("AuthFailed", { reason: "unauthenticated" });
      const p = providers.find((c) => c.id === input.provider);
      if (!p) return fail("AuthFailed", { reason: "provider_disabled" });
      const redirectUri = resolveRedirectUri(p, options);
      const clientId = p.config.clientId;
      if (!redirectUri || !clientId) {
        return fail("AuthFailed", { reason: "provider_misconfigured" });
      }
      const state = generateState();
      const { verifier, challenge } = await mintPkcePair();
      const nonce = p.driver.kind === "oidc" ? generateState() : undefined;
      await putOauthFlow(
        verifications,
        {
          provider: p.id,
          stateHash: await hashChallenge(state),
          codeVerifier: verifier,
          redirectUri,
          ...(nonce !== undefined ? { nonce } : {}),
          expectedIssuer: p.driver.authorizationServerId,
          clientId,
          currentUserId,
        },
        now(),
      );
      return {
        provider: p.id,
        authorizationUrl: p.driver.buildAuthorizeUrl({
          clientId,
          redirectUri,
          scopes: p.config.scopes ?? [],
          state,
          codeChallenge: challenge,
          ...(nonce !== undefined ? { nonce } : {}),
        }).url,
        expiresInMs: OAUTH_FLOW_TTL_MS,
      };
    },
  });

  const def = plugin("oauth", {
    version: "0.0.1",
    config: { providers: providers.map((p) => p.id) },
  })
    .needs("auth")
    .flow(start)
    .flow(callback)
    .flow(linkStart);

  def.binding(bindPublicAuth("/oauth/:provider/start", start, "otp"));
  for (const b of bindCallbackBothMethods(callback)) def.binding(b);
  def.binding(bindSessionAuth("/oauth/:provider/link", linkStart));

  for (const contract of vaultContracts(providers)) def.vault(contract);

  return def;
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

const OAUTH_FLOW_TTL_MS = 10 * 60_000;

/**
 * Bind the callback flow to both GET (standard `?code=` redirects) and POST
 * (Apple `response_mode=form_post`) on the same per-provider path.
 *
 * @param flowDef - Callback flow
 */
function bindCallbackBothMethods(flowDef: AnyFlowDef): Binding[] {
  const gates = authPublicGates("otp");
  const getBinding = bindPublicAuthGet("/auth/oauth/callback/:provider", flowDef, gates);
  const postBinding = bindAuthHttp(
    http
      .post("/auth/oauth/callback/:provider")
      .public()
      .gate(...gates),
    flowDef,
  );
  return [getBinding, postBinding];
}

function buildProviders(options: OAuthOptions): ReadonlyArray<ProviderRuntime> {
  const out: ProviderRuntime[] = [];
  for (const id of OAUTH_PROVIDER_IDS) {
    const config = options.providers?.[id];
    if (!config?.enabled) continue;
    const common = {
      ...(config.scopes !== undefined ? { scopes: config.scopes } : {}),
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    };
    let driver: OAuthDriver;
    switch (id) {
      case "google":
        driver = openOAuthGoogle(common);
        break;
      case "apple":
        driver = openOAuthApple({
          ...common,
          ...(config.teamId !== undefined ? { teamId: config.teamId } : {}),
          ...(config.keyId !== undefined ? { keyId: config.keyId } : {}),
        });
        break;
      case "microsoft":
        driver = openOAuthMicrosoft({
          ...common,
          ...(config.tenant !== undefined ? { tenant: config.tenant } : {}),
        });
        break;
      case "github":
        driver = openOAuthGithub(common);
        break;
      case "discord":
        driver = openOAuthDiscord(common);
        break;
      case "x":
        driver = openOAuthX(common);
        break;
      case "facebook":
        driver = openOAuthFacebook(common);
        break;
      case "figma":
        driver = openOAuthFigma(common);
        break;
    }
    out.push({ id, driver, config });
  }
  return out;
}

/**
 * Exact registered redirect URI — explicit config wins, else synthesized
 * from `baseUrl` using this plugin's canonical per-provider callback path.
 */
function resolveRedirectUri(p: ProviderRuntime, options: OAuthOptions): string | undefined {
  if (p.config.redirectUri !== undefined) return p.config.redirectUri;
  if (options.baseUrl !== undefined) {
    return `${options.baseUrl.replace(/\/$/, "")}/auth/oauth/callback/${p.id}`;
  }
  return undefined;
}

/** Vault path holding the sealed per-user provider-token envelope. */
function tokenVaultPath(provider: OAuthProviderId): string {
  return `oauth/tokens/${provider}`;
}

/** Secret refs the callback may read/write (declared up front). */
function callbackSecretRefs(providers: ReadonlyArray<ProviderRuntime>): string[] {
  const refs = new Set<string>();
  for (const p of providers) {
    const upper = p.id.toUpperCase();
    if (p.id === "apple") refs.add("OAUTH_APPLE_PRIVATE_KEY");
    else refs.add(`OAUTH_${upper}_CLIENT_SECRET`);
    if (p.config.clientId === undefined) refs.add(`OAUTH_${upper}_CLIENT_ID`);
    if (p.config.storeProviderTokens === true) refs.add(tokenVaultPath(p.id));
  }
  return [...refs];
}

function vaultContracts(providers: ReadonlyArray<ProviderRuntime>) {
  const contracts = [];
  for (const p of providers) {
    if (p.id === "apple") {
      contracts.push(
        vault.secret("OAUTH_APPLE_PRIVATE_KEY", {
          description: "Sign in with Apple team private key (PKCS#8 PEM)",
          sensitive: true,
        }),
      );
    } else {
      contracts.push(
        vault.secret(`OAUTH_${p.id.toUpperCase()}_CLIENT_SECRET`, {
          description: `${p.id} OAuth client secret`,
          sensitive: true,
        }),
      );
    }
  }
  return contracts;
}

/** Extract one urlencoded field from a form_post body string. */
function fieldFromBody(body: unknown, field: string): string | undefined {
  if (typeof body !== "string") return undefined;
  return new URLSearchParams(body).get(field) ?? undefined;
}

interface ClientCredentials {
  readonly clientSecret?: string;
  readonly clientSecretJwt?: () => Promise<string>;
}

/**
 * Resolve client credential material at the Vault boundary (the one place
 * `Redacted.reveal()` is allowed).
 */
async function loadCredentials(p: ProviderRuntime, fx: Fx): Promise<ClientCredentials> {
  if (p.id === "apple") {
    const pem = (await fx.vault.get("OAUTH_APPLE_PRIVATE_KEY")).reveal();
    return {
      clientSecretJwt: async () =>
        createAppleClientSecretJwt({
          privateKeyPem: pem,
          teamId: p.config.teamId!,
          keyId: p.config.keyId!,
          clientId: p.config.clientId!,
        }),
    };
  }
  if (p.id === "x") {
    // X authorization-code+PKCE is a public client — no secret on the call.
    return {};
  }
  const upper = p.id.toUpperCase();
  const secret = (await fx.vault.get(`OAUTH_${upper}_CLIENT_SECRET`)).reveal();
  return { clientSecret: secret };
}

function credentialFailureReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("missing") || message.includes("not found")) return "secret_unavailable";
  return "secret_unavailable";
}

/**
 * Envelope-seal provider tokens per user into one static vault path.
 * Capability sets are exact-match, so dynamic per-user paths cannot be
 * declared — per-user isolation lives inside the sealed envelope.
 */
async function persistProviderTokens(
  provider: OAuthProviderId,
  userId: string,
  tokens: OAuthTokenSet,
  sealSecret: string,
  fx: Fx,
): Promise<void> {
  const path = tokenVaultPath(provider);
  let envelope: Record<string, string> = {};
  try {
    envelope = await unsealTokenEnvelope(sealSecret, (await fx.vault.get(path)).reveal());
  } catch {
    envelope = {};
  }
  const sanitized = stripRaw(tokens);
  envelope[userId] = await sealTokenEnvelope(sealSecret, JSON.stringify(sanitized));
  await fx.vault.set(path, JSON.stringify(envelope));
}

/** Drop the raw provider response before persisting. */
function stripRaw(tokens: OAuthTokenSet): Omit<OAuthTokenSet, "raw"> {
  return {
    accessToken: tokens.accessToken,
    ...(tokens.refreshToken !== undefined ? { refreshToken: tokens.refreshToken } : {}),
    ...(tokens.expiresAt !== undefined ? { expiresAt: tokens.expiresAt } : {}),
    ...(tokens.scopes !== undefined ? { scopes: tokens.scopes } : {}),
    ...(tokens.idToken !== undefined ? { idToken: tokens.idToken } : {}),
  };
}

function protocolReason(err: unknown): string {
  const reason = (err as { reason?: unknown } | null)?.reason;
  return typeof reason === "string" ? reason : "exchange_failed";
}
