/**
 * Gate auth options — resolved from `oke({ gate: { auth } })`.
 *
 * Better Auth is inspiration for shape only; this is OKE-native.
 */

import type { PasswordHashOptions } from "../runtime/types.ts";
import type { SessionStore } from "./sessions.ts";
import { createApiKeyStore, type ApiKeyStore } from "./api-keys.ts";
import type { BreachCheckFn } from "./breach-check.ts";
import type { PasswordPolicyOptions } from "./password-policy.ts";
import {
  resolveAuthSchema,
  type AuthModelOptions,
  type AuthSchemaOptions,
  type ResolvedAuthSchema,
} from "./schema.ts";
import { sessionCryptoFromAuthOptions, type AuthSessionOptions } from "./plugin.ts";
import { createTenantStore, type TenantStore } from "./tenants.ts";
import {
  resolveTenantAuth,
  type ResolvedTenantAuth,
  type TenantAuthOptions,
} from "./tenant-config.ts";

/** Email + password method knobs. */
export interface EmailAndPasswordOptions {
  readonly enabled?: boolean;
  /** Require verified email before sign-in (default false). */
  readonly requireEmailVerification?: boolean;
}

/** Account-linking policy (Phase 1 stub — enforced later with OAuth). */
export interface AccountLinkingOptions {
  readonly enabled?: boolean;
  readonly trustedProviders?: readonly string[];
  readonly allowDifferentEmails?: boolean;
}

/** Opt-in cookie session mirror (Phase 1a). Bearer remains default. */
export interface AuthCookieOptions {
  readonly enabled?: boolean;
  /** Cookie name prefix (default `oke`). */
  readonly prefix?: string;
  readonly secure?: boolean;
  /** Share across subdomains (`.example.com`). */
  readonly crossSubdomain?: boolean;
  readonly domain?: string;
  readonly sameSite?: "strict" | "lax" | "none";
  readonly path?: string;
}

/** Secondary hot-path storage (Phase 1a) — uses `store.kv` when configured. */
export interface AuthSecondaryStorageOptions {
  readonly enabled?: boolean;
  /** Kv namespace prefix (default `auth:`). */
  readonly prefix?: string;
}

/** Lifecycle hooks (Phase 1a) — fx-safe, no side-channel I/O. */
export interface AuthDatabaseHooks {
  readonly user?: {
    readonly create?: {
      readonly before?: (user: Record<string, unknown>) => unknown | Promise<unknown>;
      readonly after?: (user: Record<string, unknown>) => void | Promise<void>;
    };
  };
  readonly session?: {
    readonly create?: {
      readonly after?: (session: Record<string, unknown>) => void | Promise<void>;
    };
  };
  readonly account?: {
    readonly create?: {
      readonly after?: (account: Record<string, unknown>) => void | Promise<void>;
    };
  };
}

/** Session options under `gate.auth.session` (extends plugin session + schema). */
export interface GateAuthSessionOptions extends AuthSessionOptions, AuthModelOptions {
  /**
   * Max age (ms) from session creation for "fresh" step-up policies.
   * Default 24h. `fx.auth` / gate policies can require freshness.
   */
  readonly freshAgeMs?: number;
}

/** Public `gate.auth` bag. */
export interface GateAuthOptions extends AuthSchemaOptions {
  /** HMAC secret for access tokens. Required in prod; minted in dev when omitted. */
  readonly secret?: string;
  /** HTTP base path for auth Flows (default `/auth`). */
  readonly basePath?: string;
  /**
   * When `false`, skip materializing `/auth/*` HTTP Bindings
   * (embedding / Console — secret + tables only). Default `true`.
   */
  readonly http?: boolean;
  /** Audience stamped on access tokens (default `oke-app`). */
  readonly audience?: string;
  readonly emailAndPassword?: EmailAndPasswordOptions;
  readonly session?: GateAuthSessionOptions;
  readonly accountLinking?: AccountLinkingOptions;
  readonly password?: PasswordHashOptions;
  readonly passwordPolicy?: PasswordPolicyOptions;
  readonly breachCheck?: BreachCheckFn;
  /** Opt-in HttpOnly cookie mirror (Phase 1a). */
  readonly cookies?: AuthCookieOptions;
  /** Opt-in secondary kv storage (Phase 1a). */
  readonly secondaryStorage?: AuthSecondaryStorageOptions;
  /** Lifecycle hooks (Phase 1a). */
  readonly hooks?: AuthDatabaseHooks;
  /**
   * Pre-built session store (Console / tests). Created when omitted.
   * Not part of the public app DX — escape hatch for embedding.
   */
  readonly sessions?: SessionStore;
  /**
   * Shared API key store. Created automatically when omitted
   * (`gate.auth.secret` is the HMAC pepper).
   */
  readonly apiKeyStore?: ApiKeyStore;
  /**
   * Multi-tenancy as an identity dimension. `true` enables defaults
   * (`source: "claim"`, `required: false`). Off when omitted.
   */
  readonly tenant?: boolean | TenantAuthOptions;
  /**
   * Shared tenant registry. Created automatically when {@link tenant} is on.
   */
  readonly tenantStore?: TenantStore;
  /** Injectable clock. */
  readonly now?: () => number;
}

/** Resolved account-linking stub. */
export interface ResolvedAccountLinking {
  readonly enabled: boolean;
  readonly trustedProviders: readonly string[];
  readonly allowDifferentEmails: boolean;
}

/** Resolved cookie options. */
export interface ResolvedAuthCookies {
  readonly enabled: boolean;
  readonly prefix: string;
  readonly secure: boolean;
  readonly crossSubdomain: boolean;
  readonly domain: string | undefined;
  readonly sameSite: "strict" | "lax" | "none";
  readonly path: string;
}

/** Fully resolved Gate auth config. */
export interface ResolvedGateAuth {
  readonly enabled: true;
  readonly secret: string;
  readonly secretMinted: boolean;
  readonly basePath: string;
  /** When false, no `/auth/*` Bindings (secret / tables / Bearer only). */
  readonly http: boolean;
  readonly audience: string;
  readonly emailAndPassword: {
    readonly enabled: boolean;
    readonly requireEmailVerification: boolean;
  };
  readonly session: {
    readonly accessTtlMs: number | undefined;
    readonly refreshTtlMs: number | undefined;
    readonly idleTtlMs: number | undefined;
    readonly absoluteTtlMs: number | undefined;
    readonly singleSessionPerUser: boolean;
    readonly freshAgeMs: number;
  };
  readonly accountLinking: ResolvedAccountLinking;
  readonly schema: ResolvedAuthSchema;
  readonly password: PasswordHashOptions | undefined;
  readonly passwordPolicy: PasswordPolicyOptions | undefined;
  readonly breachCheck: BreachCheckFn | undefined;
  readonly cookies: ResolvedAuthCookies;
  readonly secondaryStorage: {
    readonly enabled: boolean;
    readonly prefix: string;
  };
  readonly hooks: AuthDatabaseHooks | undefined;
  readonly sessions: SessionStore | undefined;
  readonly apiKeyStore: ApiKeyStore;
  readonly tenant: ResolvedTenantAuth | undefined;
  readonly tenantStore: TenantStore | undefined;
  readonly now: (() => number) | undefined;
}

/** Default fresh-age window (24h). */
export const DEFAULT_FRESH_AGE_MS = 24 * 60 * 60 * 1000;

/** Options for {@link resolveGateAuth}. */
export interface ResolveGateAuthOptions {
  readonly auth: GateAuthOptions;
  /** Boot / app env (`prod` fails without secret). */
  readonly env?: string;
}

/**
 * Mint a development HMAC secret (never used in production boots).
 */
export function mintDevAuthSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `oke_dev_${Buffer.from(bytes).toString("base64url")}`;
}

/**
 * Resolve `gate.auth` — fails in prod when `secret` is missing.
 *
 * @param options - Auth bag + env
 */
export function resolveGateAuth(options: ResolveGateAuthOptions): ResolvedGateAuth {
  const { auth, env } = options;
  const isProd = env === "prod" || env === "production";
  let secret = auth.secret;
  let secretMinted = false;
  if (!secret || secret.length === 0) {
    if (isProd) {
      throw new Error(
        "gate.auth: secret is required in production (set gate.auth.secret or OKE_AUTH_SECRET)",
      );
    }
    secret = mintDevAuthSecret();
    secretMinted = true;
  }

  const sessionOpts = auth.session ?? {};
  const crypto = sessionCryptoFromAuthOptions({
    accessTtlMs: sessionOpts.accessTtlMs,
    refreshTtlMs: sessionOpts.refreshTtlMs,
    session: sessionOpts,
  });

  const schema = resolveAuthSchema({
    user: auth.user,
    account: auth.account,
    session: auth.session,
    refreshToken: auth.refreshToken,
    verification: auth.verification,
    roles: auth.roles,
    apiKeys: auth.apiKeys,
  });

  const basePath = normalizeBasePath(auth.basePath ?? "/auth");
  const cookies = auth.cookies ?? {};
  const secondary = auth.secondaryStorage ?? {};
  const linking = auth.accountLinking ?? {};

  return {
    enabled: true,
    secret,
    secretMinted,
    basePath,
    http: auth.http !== false,
    audience: auth.audience ?? "oke-app",
    emailAndPassword: {
      enabled: auth.emailAndPassword?.enabled === true,
      requireEmailVerification: auth.emailAndPassword?.requireEmailVerification === true,
    },
    session: {
      accessTtlMs: crypto.accessTtlMs,
      refreshTtlMs: crypto.refreshTtlMs,
      idleTtlMs: crypto.idleTtlMs,
      absoluteTtlMs: crypto.absoluteTtlMs,
      singleSessionPerUser: crypto.singleSessionPerUser === true,
      freshAgeMs: sessionOpts.freshAgeMs ?? DEFAULT_FRESH_AGE_MS,
    },
    accountLinking: {
      enabled: linking.enabled === true,
      trustedProviders: linking.trustedProviders ?? ["credential"],
      allowDifferentEmails: linking.allowDifferentEmails === true,
    },
    schema,
    password: auth.password,
    passwordPolicy: auth.passwordPolicy,
    breachCheck: auth.breachCheck,
    cookies: {
      enabled: cookies.enabled === true,
      prefix: cookies.prefix ?? "oke",
      secure: cookies.secure !== false,
      crossSubdomain: cookies.crossSubdomain === true,
      domain: cookies.domain,
      sameSite: cookies.sameSite ?? "lax",
      path: cookies.path ?? "/",
    },
    secondaryStorage: {
      enabled: secondary.enabled === true,
      prefix: secondary.prefix ?? "auth:",
    },
    hooks: auth.hooks,
    sessions: auth.sessions,
    apiKeyStore: auth.apiKeyStore ?? createApiKeyStore({ pepper: secret }),
    tenant: auth.tenant ? resolveTenantAuth(auth.tenant) : undefined,
    tenantStore: auth.tenant
      ? (auth.tenantStore ?? createTenantStore())
      : auth.tenantStore,
    now: auth.now,
  };
}

/**
 * Normalize auth base path (`/auth`, no trailing slash except root).
 *
 * @param path - Raw base path
 */
export function normalizeBasePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "" || trimmed === "/") return "/auth";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+$/, "") || "/auth";
}
