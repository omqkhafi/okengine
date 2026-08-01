/**
 * Materialize Gate auth HTTP surfaces as real {@link Binding}s.
 *
 * Must be pushed into `adopted` + the smart router **before**
 * `assertHttpGatePosture` — never registry `flows[]` alone.
 */

import { z } from "zod";
import { gate, type PolicyGateDecl } from "../elements/gate.ts";
import type { GateDecl } from "../elements/gate/declare.ts";
import { fail } from "../kernel/errors.ts";
import { flow, type AnyFlowDef } from "../kernel/flow.ts";
import type { Binding } from "../kernel/on.ts";
import { http, normalizeTrigger, type HttpTrigger, type Trigger } from "../kernel/triggers.ts";
import type { ResolvedGateAuth } from "./config.ts";
import { BreachCheckError } from "./breach-check.ts";
import {
  authenticateUser,
  createIdentityStore,
  createUserWithPassword,
  getUserById,
  IdentityError,
  type IdentityStore,
} from "./identity.ts";
import { PasswordPolicyError } from "./password-policy.ts";
import {
  createSessionStore,
  issueSessionWithScopes,
  revokeFamily,
  rotateRefresh,
  SessionError,
  type SessionCrypto,
  type SessionStore,
} from "./sessions.ts";
import { touchRateLimit, type LoginAttemptBag, createLoginAttemptBag } from "./rate.ts";

/** Built-in policy: verified user session (for `/auth/me` and step-up surfaces). */
export const AUTH_SESSION_GATE: PolicyGateDecl = gate.policy(
  "auth.session",
  ({ auth }) => !!auth.userId && auth.verified === true,
);

/** Built-in policy: session within `freshAge` (step-up). Requires `meta.sessionCreatedAt`. */
export function createFreshSessionGate(freshAgeMs: number): GateDecl {
  return gate.policy("auth.fresh", (ctx) => {
    if (!ctx.auth.userId || ctx.auth.verified !== true) return false;
    const createdAt = ctx.meta?.sessionCreatedAt;
    if (typeof createdAt !== "number") return false;
    return Date.now() - createdAt <= freshAgeMs;
  });
}

/** Auth rate presets (stricter on credential paths). */
export const AUTH_RATE_PRESETS = {
  signIn: { max: 5, per: "1m", keyBy: "ip" },
  signUp: { max: 10, per: "1m", keyBy: "ip" },
  refresh: { max: 30, per: "1m", keyBy: "ip" },
  otp: { max: 5, per: "1m", keyBy: "ip" },
} as const;

/** Runtime context shared by auth Flows. */
export interface AuthRuntimeContext {
  readonly config: ResolvedGateAuth;
  readonly sessions: SessionStore;
  readonly identities: IdentityStore;
  readonly loginAttempts: LoginAttemptBag;
  readonly authGates: readonly GateDecl[];
  now(): number;
  sessionCrypto(): SessionCrypto;
}

/** Result of {@link createAuthHttpBindings}. */
export interface AuthHttpMaterialization {
  readonly bindings: readonly Binding[];
  readonly flows: {
    readonly refresh: AnyFlowDef;
    readonly revoke: AnyFlowDef;
    readonly me: AnyFlowDef;
    readonly signInEmail?: AnyFlowDef;
    readonly signUpEmail?: AnyFlowDef;
  };
  readonly ctx: AuthRuntimeContext;
  /** Rate + policy gates to merge into boot `gates`. */
  readonly authGates: readonly GateDecl[];
}

const SessionTokensOut = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: z.number(),
  userId: z.string().optional(),
});

const RefreshIn = z.object({
  refreshToken: z.string().min(1),
});

const RevokeIn = z.object({
  refreshToken: z.string().min(1).optional(),
});

const EmailPasswordIn = z.object({
  email: z.string().min(3),
  password: z.string().min(1),
  name: z.string().optional(),
});

const AuthFailed = z.object({
  reason: z.string().optional(),
  /** Password-policy failure details (`reason: "password_policy"`). */
  reasons: z.array(z.string()).optional(),
});

const AuthRateLimited = z.object({
  reason: z.string(),
});

const MeOut = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  emailVerified: z.boolean(),
});

/**
 * Build rate gate decls for auth paths (when rate limiting enabled).
 *
 * @param enabled - Whether presets are active
 */
export function createAuthRateGates(enabled: boolean): GateDecl[] {
  if (!enabled) return [];
  return [
    gate.rate({
      max: AUTH_RATE_PRESETS.signIn.max,
      per: AUTH_RATE_PRESETS.signIn.per,
      keyBy: AUTH_RATE_PRESETS.signIn.keyBy,
      description: "Auth sign-in rate limit",
    }),
    gate.rate({
      max: AUTH_RATE_PRESETS.signUp.max,
      per: AUTH_RATE_PRESETS.signUp.per,
      keyBy: AUTH_RATE_PRESETS.signUp.keyBy,
      description: "Auth sign-up rate limit",
    }),
    gate.rate({
      max: AUTH_RATE_PRESETS.refresh.max,
      per: AUTH_RATE_PRESETS.refresh.per,
      keyBy: AUTH_RATE_PRESETS.refresh.keyBy,
      description: "Auth refresh rate limit",
    }),
  ];
}

/**
 * Policy gates contributed by Gate auth (session + optional fresh).
 *
 * @param config - Resolved auth
 */
export function createAuthPolicyGates(config: ResolvedGateAuth): GateDecl[] {
  return [AUTH_SESSION_GATE, createFreshSessionGate(config.session.freshAgeMs)];
}

/**
 * Materialize auth HTTP Bindings for the same `adopted` / router / posture path.
 *
 * @param config - Resolved gate.auth
 * @param options - Rate-limit enable + optional shared stores
 */
export function createAuthHttpBindings(
  config: ResolvedGateAuth,
  options: {
    readonly rateLimitEnabled?: boolean;
    readonly sessions?: SessionStore;
    readonly identities?: IdentityStore;
  } = {},
): AuthHttpMaterialization {
  const sessions = options.sessions ?? config.sessions ?? createSessionStore();
  const identities = options.identities ?? createIdentityStore();
  const loginAttempts = createLoginAttemptBag();
  const rateGates = createAuthRateGates(options.rateLimitEnabled !== false);
  const policyGates = createAuthPolicyGates(config);
  const authGates = [...policyGates, ...rateGates];
  const signInRate = rateGates[0];
  const signUpRate = rateGates[1];
  const refreshRate = rateGates[2];

  const ctx: AuthRuntimeContext = {
    config,
    sessions,
    identities,
    loginAttempts,
    authGates,
    now: () => (config.now ?? (() => Date.now()))(),
    sessionCrypto: () => ({
      secret: config.secret,
      now: () => ctx.now(),
      accessTtlMs: config.session.accessTtlMs,
      refreshTtlMs: config.session.refreshTtlMs,
      idleTtlMs: config.session.idleTtlMs,
      absoluteTtlMs: config.session.absoluteTtlMs,
      singleSessionPerUser: config.session.singleSessionPerUser,
      audience: config.audience,
    }),
  };

  const base = config.basePath;

  const refresh = flow({
    name: "auth.refresh",
    unit: "auth",
    plane: "user",
    in: RefreshIn,
    out: SessionTokensOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async (input) => {
      try {
        const issued = await rotateRefresh(sessions, ctx.sessionCrypto(), input.refreshToken);
        return {
          accessToken: issued.accessToken,
          refreshToken: issued.refreshToken,
          accessExpiresAt: issued.accessExpiresAt,
          userId: issued.session.principalId,
        };
      } catch (err) {
        if (err instanceof SessionError) {
          // Enumeration-safe: same error shape for unknown / reused / expired.
          return fail("AuthFailed", { reason: "invalid_refresh" });
        }
        throw err;
      }
    },
  });

  const revoke = flow({
    name: "auth.revoke",
    unit: "auth",
    plane: "user",
    in: RevokeIn,
    out: z.object({ ok: z.literal(true) }),
    errors: { AuthFailed },
    do: async (input) => {
      if (input.refreshToken) {
        try {
          const hash = await hashRefresh(input.refreshToken);
          const row = [...sessions.refresh.values()].find((r) => r.hash === hash);
          if (row) revokeFamily(sessions, row.familyId, ctx.now());
        } catch {
          /* ignore — revoke is idempotent */
        }
      }
      return { ok: true as const };
    },
  });

  const me = flow({
    name: "auth.me",
    unit: "auth",
    plane: "user",
    out: MeOut,
    errors: { AuthFailed },
    do: (_input, fx) => {
      const userId = fx.auth.userId;
      if (!userId) return fail("AuthFailed", { reason: "unauthenticated" });
      const user = getUserById(identities, userId);
      if (!user) return fail("AuthFailed", { reason: "unauthenticated" });
      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
      };
    },
  });

  const flows: {
    refresh: AnyFlowDef;
    revoke: AnyFlowDef;
    me: AnyFlowDef;
    signInEmail?: AnyFlowDef;
    signUpEmail?: AnyFlowDef;
  } = { refresh, revoke, me };
  const bindings: Binding[] = [
    bindAuthHttp(
      http.post(`${base}/refresh`).gate(gate.public, ...(refreshRate ? [refreshRate] : [])),
      refresh,
    ),
    bindAuthHttp(http.post(`${base}/revoke`).gate(gate.public), revoke),
    bindAuthHttp(http.get(`${base}/me`).gate(AUTH_SESSION_GATE), me),
  ];

  if (config.emailAndPassword.enabled) {
    const signInEmail = flow({
      name: "auth.signInEmail",
      unit: "auth",
      plane: "user",
      in: EmailPasswordIn,
      out: SessionTokensOut,
      errors: { AuthFailed, AuthRateLimited },
      do: async (input) => {
        const key = input.email.trim().toLowerCase();
        let bag = loginAttempts.get(key);
        if (!bag) {
          bag = [];
          loginAttempts.set(key, bag);
        }
        if (touchRateLimit(bag, ctx.now()) === "rate_limited") {
          return fail("AuthRateLimited", {
            reason: "rate_limited",
          });
        }
        const user = await authenticateUser(identities, input.email, input.password);
        // Enumeration hygiene: identical failure for unknown email / bad password.
        if (!user) return fail("AuthFailed", { reason: "invalid_credentials" });
        if (config.emailAndPassword.requireEmailVerification && !user.emailVerified) {
          return fail("AuthFailed", { reason: "invalid_credentials" });
        }
        const issued = await issueSessionWithScopes(sessions, ctx.sessionCrypto(), {
          id: user.id,
          plane: "user",
          scopes: [],
        });
        return {
          accessToken: issued.accessToken,
          refreshToken: issued.refreshToken,
          accessExpiresAt: issued.accessExpiresAt,
          userId: user.id,
        };
      },
    });

    const signUpEmail = flow({
      name: "auth.signUpEmail",
      unit: "auth",
      plane: "user",
      in: EmailPasswordIn,
      out: SessionTokensOut,
      errors: { AuthFailed, AuthRateLimited },
      do: async (input) => {
        try {
          const user = await createUserWithPassword(identities, {
            email: input.email,
            password: input.password,
            name: input.name,
            passwordPolicy: config.passwordPolicy,
            passwordHash: config.password,
            breachCheck: config.breachCheck,
            now: () => ctx.now(),
          });
          if (config.hooks?.user?.create?.after) {
            await config.hooks.user.create.after({
              id: user.id,
              email: user.email,
              name: user.name,
            });
          }
          const issued = await issueSessionWithScopes(sessions, ctx.sessionCrypto(), {
            id: user.id,
            plane: "user",
            scopes: [],
          });
          return {
            accessToken: issued.accessToken,
            refreshToken: issued.refreshToken,
            accessExpiresAt: issued.accessExpiresAt,
            userId: user.id,
          };
        } catch (err) {
          if (err instanceof PasswordPolicyError) {
            return fail("AuthFailed", {
              reason: "password_policy",
              reasons: [...err.reasons],
            });
          }
          if (err instanceof BreachCheckError) {
            return fail("AuthFailed", { reason: "password_breached" });
          }
          if (err instanceof IdentityError) {
            // Enumeration-safe on email_taken — same shape as generic failure.
            if (err.code === "email_taken") {
              return fail("AuthFailed", { reason: "invalid_credentials" });
            }
            return fail("AuthFailed", { reason: err.code });
          }
          throw err;
        }
      },
    });

    flows.signInEmail = signInEmail;
    flows.signUpEmail = signUpEmail;
    bindings.push(
      bindAuthHttp(
        http.post(`${base}/sign-in/email`).gate(gate.public, ...(signInRate ? [signInRate] : [])),
        signInEmail,
      ),
      bindAuthHttp(
        http.post(`${base}/sign-up/email`).gate(gate.public, ...(signUpRate ? [signUpRate] : [])),
        signUpEmail,
      ),
    );
  }

  return { bindings, flows, ctx, authGates };
}

/**
 * Whether a session is still within the fresh-age window.
 *
 * @param createdAt - Session creation epoch-ms
 * @param freshAgeMs - Fresh window
 * @param now - Clock
 */
export function isSessionFresh(
  createdAt: number,
  freshAgeMs: number,
  now: number = Date.now(),
): boolean {
  return now - createdAt <= freshAgeMs;
}

/**
 * Bind without touching the global `on` registry.
 *
 * @param trigger - HTTP trigger (must already carry posture)
 * @param flowDef - Flow
 */
export function bindAuthHttp(trigger: HttpTrigger, flowDef: AnyFlowDef): Binding {
  const withPosture = trigger.gates.length > 0 ? trigger : trigger.gate(gate.public);
  const normalized = normalizeTrigger(withPosture);
  const list = flowDef.triggers as Trigger[];
  list.push(normalized);
  (flowDef as { $trigger: Trigger }).$trigger = normalized;
  return { trigger: normalized, flow: flowDef };
}

async function hashRefresh(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
