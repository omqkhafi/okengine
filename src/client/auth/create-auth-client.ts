/**
 * Secure-by-default auth orchestration over typed `/auth/*` Flows.
 *
 * @module
 */

import {
  isSessionTokens,
  isTwoFactorRequired,
} from "./denials.ts";
import { memorySession, type MemorySession, type SessionUser } from "./session.ts";

/** Auth transport mode. */
export type AuthMode = "bearer" | "cookie";

/** Bearer persist strategy. */
export type AuthPersist = "memory" | "sessionStorage" | "localStorage";

/** Options for {@link createAuthClient} / `createClient({ auth })`. */
export interface CreateAuthClientOptions {
  /**
   * Session transport. Default: `"bearer"`.
   * Prefer `"cookie"` when `gate.auth.cookies.enabled` (HttpOnly).
   */
  readonly mode?: AuthMode;
  /**
   * Bearer token storage. Default `"memory"`.
   * `"localStorage"` is an explicit XSS tradeoff — never silent.
   * Forbidden when `mode: "cookie"`.
   */
  readonly persist?: AuthPersist;
  /** Storage key for bearer persist (default `oke.session`). */
  readonly storageKey?: string;
  /**
   * Tenant header name for {@link AuthClient.setTenant} (default `x-oke-tenant`).
   */
  readonly tenantHeader?: string;
  /**
   * When `mode: "cookie"` and this is not `true`, warn in development that
   * the `csrf` plugin should be installed (`allowNoHeader: false` for cookie-only).
   */
  readonly csrfConfigured?: boolean;
  /** Custom session bag (tests). Ignored in cookie mode. */
  readonly session?: MemorySession;
  /** Override `globalThis` for Storage / warn. */
  readonly env?: {
    readonly localStorage?: Storage;
    readonly sessionStorage?: Storage;
    readonly warn?: (message: string) => void;
  };
  /**
   * SSR / custom Bearer override. Cookie mode still sends credentials;
   * this is ignored for Authorization when `mode: "cookie"` unless you
   * need a non-null getToken for tests.
   */
  readonly getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** SSR / custom refresh after HTTP 401. */
  readonly refresh?: () => Promise<string | null | undefined>;
}

/** UI authorize query — all required, or any sufficient. */
export type AuthorizeQuery =
  | { readonly all: readonly string[]; readonly any?: undefined }
  | { readonly any: readonly string[]; readonly all?: undefined };

/** UI authorize result — never a security boundary (Gate on Flows is). */
export type AuthorizeResult =
  | { readonly status: "loading" }
  | { readonly status: "unauthenticated" }
  | { readonly status: "allowed" }
  | { readonly status: "denied"; readonly missing: readonly string[] };

/** Minimal typed client surface used by the auth helper. */
export interface AuthApi {
  auth: {
    refresh?: (input: { refreshToken: string }) => Promise<{
      data: {
        accessToken: string;
        refreshToken: string;
        accessExpiresAt?: number;
        userId?: string;
      } | null;
      error: unknown;
    }>;
    revoke?: (input?: { refreshToken?: string }) => Promise<{
      data: unknown;
      error: unknown;
    }>;
    me?: (input?: unknown) => Promise<{
      data: {
        userId: string;
        email: string;
        name: string;
        emailVerified?: boolean;
        scopes?: readonly string[];
        tenantId?: string | null;
        apiKeyId?: string | null;
        sessionFresh?: boolean;
      } | null;
      error: unknown;
    }>;
    signInEmail?: (input: {
      email: string;
      password: string;
    }) => Promise<{ data: unknown; error: unknown }>;
    signUpEmail?: (input: {
      email: string;
      password: string;
      name?: string;
    }) => Promise<{ data: unknown; error: unknown }>;
    signInUsername?: (input: {
      username: string;
      password: string;
    }) => Promise<{ data: unknown; error: unknown }>;
    signUpUsername?: (input: {
      username: string;
      password: string;
      name?: string;
    }) => Promise<{ data: unknown; error: unknown }>;
    signInAnonymous?: (input?: unknown) => Promise<{ data: unknown; error: unknown }>;
    oauthStart?: (input: { provider: string }) => Promise<{
      data: { authorizationUrl: string; provider: string } | null;
      error: unknown;
    }>;
    requestMagicLink?: (input: { email: string }) => Promise<{ data: unknown; error: unknown }>;
    verifyMagicLink?: (input: { token: string }) => Promise<{ data: unknown; error: unknown }>;
    requestOtp?: (input: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    verifyOtp?: (input: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    resendOtp?: (input: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    passkeyAuthenticateOptions?: (input?: {
      email?: string;
    }) => Promise<{ data: unknown; error: unknown }>;
    passkeyAuthenticate?: (input: Record<string, unknown>) => Promise<{
      data: unknown;
      error: unknown;
    }>;
    passkeyRegisterOptions?: (input?: unknown) => Promise<{ data: unknown; error: unknown }>;
    passkeyRegister?: (input: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    twoFactorVerify?: (input: {
      challengeId: string;
      code: string;
    }) => Promise<{ data: unknown; error: unknown }>;
    twoFactorStepUp?: (input: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    [key: string]: unknown;
  };
}

/** Result of a sign-in attempt. */
export type SignInResult =
  | { readonly ok: true; readonly user: SessionUser | null }
  | {
      readonly ok: false;
      readonly error: unknown;
      readonly twoFactor?: {
        readonly challengeId: string;
        readonly method: string;
        readonly userId: string;
      };
    };

/** Auth client — convenience over existing Flows. */
export interface AuthClient {
  readonly mode: AuthMode;
  /** Session bag (memory; Storage only for explicit bearer persist). */
  readonly session: MemorySession;
  /**
   * Rebind Flow calls to a credentialed `createClient` instance
   * (after spreading {@link clientOptions}).
   */
  bind(api: AuthApi): void;
  /** Options to spread into {@link createClient}. */
  readonly clientOptions: {
    readonly credentials?: "include" | "omit" | "same-origin";
    readonly auth?: {
      readonly getToken: () => string | null | undefined | Promise<string | null | undefined>;
      readonly refresh: () => Promise<string | null | undefined>;
    };
    readonly headers?: () => Record<string, string>;
  };
  /** UI-only — never a security boundary. Gate on Flows is real authz. */
  hasScope(scope: string): boolean;
  /** UI-only — all scopes required. */
  can(...scopes: string[]): boolean;
  /** UI-only — any scope. */
  hasAnyScope(...scopes: string[]): boolean;
  /**
   * UI-only authorize helper (loading / unauthenticated / allowed / denied).
   * Prefer this over bare `hasScope` for chrome; Gate on Flows remains real authz.
   */
  authorize(query: AuthorizeQuery): AuthorizeResult;
  getSession(): Promise<SessionUser | null>;
  subscribe(listener: () => void): () => void;
  signOut(): Promise<void>;
  setTenant(tenantId: string | null): void;
  switchTenant(
    tenantId: string,
    switchFlow?: (input: { tenantId: string }) => Promise<{ data: unknown; error: unknown }>,
  ): Promise<{ data: unknown; error: unknown }>;
  readonly signIn: {
    email(input: { email: string; password: string }): Promise<SignInResult>;
    username(input: { username: string; password: string }): Promise<SignInResult>;
    anonymous(): Promise<SignInResult>;
    social(input: { provider: string; assign?: (url: string) => void }): Promise<SignInResult>;
    magicLink: {
      request(input: { email: string }): Promise<{ data: unknown; error: unknown }>;
      verify(input: { token: string }): Promise<SignInResult>;
    };
    otp: {
      request(input: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
      verify(input: Record<string, unknown>): Promise<SignInResult>;
      resend(input: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
    };
    passkey(input?: { email?: string }): Promise<SignInResult>;
  };
  readonly signUp: {
    email(input: { email: string; password: string; name?: string }): Promise<SignInResult>;
    username(input: { username: string; password: string; name?: string }): Promise<SignInResult>;
  };
  completeChallenge(input: { challengeId: string; code: string }): Promise<SignInResult>;
}

/**
 * Create a secure-by-default auth helper over an existing typed client.
 *
 * @param api - Client from {@link createClient} (must expose `auth.*` Flows)
 * @param options - Mode / persist / CSRF checklist
 */
export function createAuthClient(
  api: AuthApi,
  options: CreateAuthClientOptions = {},
): AuthClient {
  let apiRef = api;
  const mode: AuthMode = options.mode ?? "bearer";
  const persist: AuthPersist = options.persist ?? "memory";
  const warn = options.env?.warn ?? ((m: string) => console.warn(m));

  if (mode === "cookie" && options.persist !== undefined && options.persist !== "memory") {
    throw new Error(
      'okengine/client/auth: cookie mode cannot persist tokens to Storage (dual CSRF+XSS). Use mode: "cookie" alone.',
    );
  }
  if (mode === "cookie" && options.csrfConfigured !== true) {
    warn(
      "[okengine/client/auth] cookie mode: install the csrf plugin (allowNoHeader: false for cookie-only) and cors with credentials when cross-origin.",
    );
  }
  if (persist === "localStorage") {
    warn(
      "[okengine/client/auth] persist: \"localStorage\" stores access/refresh where XSS can read them. Prefer cookie mode or memory / sessionStorage.",
    );
  }

  /**
   * Cookie mode keeps a memory-only refresh handle for `/auth/refresh` + revoke
   * (HttpOnly refresh cookie is not JS-readable). Access rides on credentials cookies —
   * never write tokens to Storage and never send Bearer when cookies own the session.
   */
  const session: MemorySession =
    options.session ??
    (mode === "cookie"
      ? memorySession()
      : memorySession(
          persist === "memory"
            ? undefined
            : {
                storage:
                  persist === "localStorage"
                    ? (options.env?.localStorage ?? globalThis.localStorage)
                    : (options.env?.sessionStorage ?? globalThis.sessionStorage),
                key: options.storageKey,
              },
        ));

  let tenantId: string | null = session.tenantId ?? null;
  const tenantHeader = options.tenantHeader ?? "x-oke-tenant";
  /** False until first getSession / sign-in / sign-out — drives authorize("loading"). */
  let sessionResolved = session.user !== null || (mode === "bearer" && session.getToken() !== null);

  async function applyAuthResult(data: unknown, error: unknown): Promise<SignInResult> {
    sessionResolved = true;
    if (error) return { ok: false, error };
    if (isTwoFactorRequired(data)) {
      return {
        ok: false,
        error: null,
        twoFactor: {
          challengeId: data.challengeId,
          method: data.method,
          userId: data.userId,
        },
      };
    }
    if (isSessionTokens(data)) {
      session.set({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        accessExpiresAt: data.accessExpiresAt,
        userId: data.userId,
        tenantId,
      });
      const user = await refreshMe();
      return { ok: true, user };
    }
    return { ok: false, error: { code: "AuthFailed", data: { reason: "unexpected_response" } } };
  }

  async function refreshMe(): Promise<SessionUser | null> {
    sessionResolved = true;
    if (!apiRef.auth.me) return session.user ?? null;
    const { data, error } = await apiRef.auth.me({});
    if (error || !data) {
      session.setUser(null);
      return null;
    }
    const user: SessionUser = {
      userId: data.userId,
      email: data.email,
      name: data.name,
      emailVerified: data.emailVerified,
      scopes: data.scopes ?? [],
      tenantId: data.tenantId ?? tenantId,
      apiKeyId: data.apiKeyId ?? null,
      ...(data.sessionFresh !== undefined ? { sessionFresh: data.sessionFresh } : {}),
    };
    session.setUser(user);
    if (user.tenantId !== undefined) tenantId = user.tenantId;
    return user;
  }

  function scopesOf(): readonly string[] {
    return session.user?.scopes ?? session.scopes ?? [];
  }

  function authorize(query: AuthorizeQuery): AuthorizeResult {
    if (!sessionResolved) {
      if (mode === "bearer" && !session.getToken()) return { status: "unauthenticated" };
      return { status: "loading" };
    }
    if (!session.user) return { status: "unauthenticated" };
    const have = new Set(scopesOf());
    if ("all" in query && query.all) {
      const missing = query.all.filter((s) => !have.has(s));
      return missing.length === 0 ? { status: "allowed" } : { status: "denied", missing };
    }
    if ("any" in query && query.any) {
      const ok = query.any.some((s) => have.has(s));
      return ok ? { status: "allowed" } : { status: "denied", missing: [...query.any] };
    }
    return { status: "denied", missing: [] };
  }

  const signIn = {
    async email(input: { email: string; password: string }): Promise<SignInResult> {
      if (!apiRef.auth.signInEmail) {
        return { ok: false, error: { code: "AuthFailed", data: { reason: "method_unavailable" } } };
      }
      const { data, error } = await apiRef.auth.signInEmail(input);
      return applyAuthResult(data, error);
    },
    async username(input: { username: string; password: string }): Promise<SignInResult> {
      if (!apiRef.auth.signInUsername) {
        return { ok: false, error: { code: "AuthFailed", data: { reason: "method_unavailable" } } };
      }
      const { data, error } = await apiRef.auth.signInUsername(input);
      return applyAuthResult(data, error);
    },
    async anonymous(): Promise<SignInResult> {
      if (!apiRef.auth.signInAnonymous) {
        return { ok: false, error: { code: "AuthFailed", data: { reason: "method_unavailable" } } };
      }
      const { data, error } = await apiRef.auth.signInAnonymous({});
      return applyAuthResult(data, error);
    },
    async social(input: {
      provider: string;
      assign?: (url: string) => void;
    }): Promise<SignInResult> {
      if (!apiRef.auth.oauthStart) {
        return { ok: false, error: { code: "AuthFailed", data: { reason: "method_unavailable" } } };
      }
      const { data, error } = await apiRef.auth.oauthStart({ provider: input.provider });
      if (error || !data?.authorizationUrl) return { ok: false, error: error ?? null };
      const assign =
        input.assign ??
        ((url: string) => {
          const loc = (globalThis as { location?: { assign?: (href: string) => void } }).location;
          loc?.assign?.(url);
        });
      assign(data.authorizationUrl);
      return { ok: true, user: null };
    },
    magicLink: {
      async request(input: { email: string }) {
        if (!apiRef.auth.requestMagicLink) {
          return {
            data: null,
            error: { code: "AuthFailed", data: { reason: "method_unavailable" } },
          };
        }
        return apiRef.auth.requestMagicLink(input);
      },
      async verify(input: { token: string }): Promise<SignInResult> {
        if (!apiRef.auth.verifyMagicLink) {
          return {
            ok: false,
            error: { code: "AuthFailed", data: { reason: "method_unavailable" } },
          };
        }
        const { data, error } = await apiRef.auth.verifyMagicLink(input);
        return applyAuthResult(data, error);
      },
    },
    otp: {
      async request(input: Record<string, unknown>) {
        if (!apiRef.auth.requestOtp) {
          return {
            data: null,
            error: { code: "AuthFailed", data: { reason: "method_unavailable" } },
          };
        }
        return apiRef.auth.requestOtp(input);
      },
      async verify(input: Record<string, unknown>): Promise<SignInResult> {
        if (!apiRef.auth.verifyOtp) {
          return {
            ok: false,
            error: { code: "AuthFailed", data: { reason: "method_unavailable" } },
          };
        }
        const { data, error } = await apiRef.auth.verifyOtp(input);
        return applyAuthResult(data, error);
      },
      async resend(input: Record<string, unknown>) {
        if (!apiRef.auth.resendOtp) {
          return {
            data: null,
            error: { code: "AuthFailed", data: { reason: "method_unavailable" } },
          };
        }
        return apiRef.auth.resendOtp(input);
      },
    },
    async passkey(input?: { email?: string }): Promise<SignInResult> {
      return signInWithPasskey(apiRef, input, applyAuthResult);
    },
  };

  const signUp = {
    async email(input: {
      email: string;
      password: string;
      name?: string;
    }): Promise<SignInResult> {
      if (!apiRef.auth.signUpEmail) {
        return { ok: false, error: { code: "AuthFailed", data: { reason: "method_unavailable" } } };
      }
      const { data, error } = await apiRef.auth.signUpEmail(input);
      return applyAuthResult(data, error);
    },
    async username(input: {
      username: string;
      password: string;
      name?: string;
    }): Promise<SignInResult> {
      if (!apiRef.auth.signUpUsername) {
        return { ok: false, error: { code: "AuthFailed", data: { reason: "method_unavailable" } } };
      }
      const { data, error } = await apiRef.auth.signUpUsername(input);
      return applyAuthResult(data, error);
    },
  };

  return {
    mode,
    session,
    bind(next) {
      apiRef = next;
    },
    clientOptions: {
      ...(mode === "cookie" ? { credentials: "include" as const } : {}),
      auth: {
        // Cookie mode: access is HttpOnly — do not attach Bearer (avoids dual surface).
        getToken:
          options.getToken ??
          (() => (mode === "cookie" ? null : session.getToken())),
        refresh:
          options.refresh ??
          (() => session.refresh(apiRef as never)),
      },
      headers: () => {
        const h: Record<string, string> = {};
        if (tenantId) h[tenantHeader] = tenantId;
        return h;
      },
    },
    hasScope(scope: string) {
      return scopesOf().includes(scope);
    },
    can(...scopes: string[]) {
      const have = new Set(scopesOf());
      return scopes.every((s) => have.has(s));
    },
    hasAnyScope(...scopes: string[]) {
      const have = new Set(scopesOf());
      return scopes.some((s) => have.has(s));
    },
    authorize,
    getSession: refreshMe,
    subscribe(listener) {
      return session.subscribe(listener);
    },
    async signOut() {
      sessionResolved = true;
      if (apiRef.auth.revoke) {
        const refreshToken = session.refreshToken;
        await apiRef.auth.revoke(refreshToken ? { refreshToken } : {});
      }
      session.clear();
      tenantId = null;
    },
    setTenant(id) {
      tenantId = id;
      session.tenantId = id;
    },
    async switchTenant(id, switchFlow) {
      if (!switchFlow) {
        this.setTenant(id);
        return { data: { tenantId: id }, error: null };
      }
      const result = await switchFlow({ tenantId: id });
      if (!result.error) this.setTenant(id);
      return result;
    },
    signIn,
    signUp,
    async completeChallenge(input) {
      if (!apiRef.auth.twoFactorVerify) {
        return { ok: false, error: { code: "AuthFailed", data: { reason: "method_unavailable" } } };
      }
      const { data, error } = await apiRef.auth.twoFactorVerify(input);
      return applyAuthResult(data, error);
    },
  };
}

async function signInWithPasskey(
  api: AuthApi,
  input: { email?: string } | undefined,
  applyAuthResult: (data: unknown, error: unknown) => Promise<SignInResult>,
): Promise<SignInResult> {
  if (!api.auth.passkeyAuthenticateOptions || !api.auth.passkeyAuthenticate) {
    return { ok: false, error: { code: "AuthFailed", data: { reason: "method_unavailable" } } };
  }
  const opts = await api.auth.passkeyAuthenticateOptions(
    input?.email ? { email: input.email } : {},
  );
  if (opts.error || !opts.data || typeof opts.data !== "object") {
    return { ok: false, error: opts.error };
  }
  const o = opts.data as {
    challenge: string;
    sessionId: string;
    rpId: string;
    allowCredentials: readonly string[];
  };
  const nav = (
    globalThis as {
      navigator?: {
        credentials?: {
          get: (options: unknown) => Promise<unknown>;
        };
      };
    }
  ).navigator;
  if (!nav?.credentials?.get) {
    return { ok: false, error: { code: "AuthFailed", data: { reason: "passkey_unavailable" } } };
  }
  const cred = await nav.credentials.get({
    publicKey: {
      challenge: bufferFromBase64Url(o.challenge),
      rpId: o.rpId,
      userVerification: "required",
      allowCredentials: o.allowCredentials.map((id) => ({
        type: "public-key" as const,
        id: bufferFromBase64Url(id),
      })),
    },
  });
  if (!isPasskeyAssertion(cred)) {
    return { ok: false, error: { code: "AuthFailed", data: { reason: "passkey_cancelled" } } };
  }
  const { data, error } = await api.auth.passkeyAuthenticate({
    credentialId: base64UrlFromBuffer(cred.rawId),
    clientDataJSON: base64UrlFromBuffer(cred.response.clientDataJSON),
    authenticatorData: base64UrlFromBuffer(cred.response.authenticatorData),
    signature: base64UrlFromBuffer(cred.response.signature),
    challenge: o.challenge,
    sessionId: o.sessionId,
    ...(input?.email ? { email: input.email } : {}),
  });
  return applyAuthResult(data, error);
}

/** Duck-type WebAuthn assertion without DOM `PublicKeyCredential` lib. */
function isPasskeyAssertion(value: unknown): value is {
  readonly rawId: ArrayBuffer;
  readonly response: {
    readonly clientDataJSON: ArrayBuffer;
    readonly authenticatorData: ArrayBuffer;
    readonly signature: ArrayBuffer;
  };
} {
  if (value === null || typeof value !== "object") return false;
  const bag = value as {
    rawId?: unknown;
    response?: {
      clientDataJSON?: unknown;
      authenticatorData?: unknown;
      signature?: unknown;
    };
  };
  return (
    bag.rawId instanceof ArrayBuffer &&
    bag.response !== null &&
    typeof bag.response === "object" &&
    bag.response.clientDataJSON instanceof ArrayBuffer &&
    bag.response.authenticatorData instanceof ArrayBuffer &&
    bag.response.signature instanceof ArrayBuffer
  );
}

function bufferFromBase64Url(value: string): ArrayBuffer {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const b64 = (value + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function base64UrlFromBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
