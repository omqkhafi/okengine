/**
 * Shared helpers for Gate auth method plugins.
 */

import { z } from "zod";
import { AUTH_RATE_PRESETS, AUTH_SESSION_GATE, bindAuthHttp } from "../../auth/bindings.ts";
import { getActiveGateAuthContext } from "../../auth/method-context.ts";
import { createSessionStore, type SessionCrypto, type SessionStore } from "../../auth/sessions.ts";
import { gate } from "../../elements/gate.ts";
import type { GateDecl } from "../../elements/gate/declare.ts";
import { fail } from "../../kernel/errors.ts";
import { flow, type AnyFlowDef } from "../../kernel/flow.ts";
import type { Binding } from "../../kernel/on.ts";
import { http } from "../../kernel/triggers.ts";
import { createEnv } from "../../runtime/primitives.ts";

export const AuthFailed = z.object({ reason: z.string().optional() });
export const AuthRateLimited = z.object({ reason: z.string() });

export const SessionTokensOut = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: z.number(),
  userId: z.string().optional(),
});

/** Common options for auth method plugins (session issue). */
export interface AuthMethodOptions {
  /** HMAC secret; falls back to `OKE_AUTH_SECRET`, then a dev default. */
  readonly secret?: string;
  /** Shared session store (prefer the same store as `gate.auth`). */
  readonly sessions?: SessionStore;
  /** Injectable clock. */
  readonly now?: () => number;
}

/**
 * Resolve HMAC secret for method plugins.
 *
 * @param opts - Optional explicit secret
 */
export function resolveMethodSecret(opts: { readonly secret?: string } = {}): string {
  if (opts.secret && opts.secret.length > 0) return opts.secret;
  const active = getActiveGateAuthContext();
  if (active?.secret) return active.secret;
  const fromEnv = createEnv().get("OKE_AUTH_SECRET");
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return "oke-dev-auth-secret-change-me";
}

/**
 * Session store + crypto closed over by a method plugin factory.
 * Prefers explicit opts, then the active `gate.auth` context from `oke()`.
 *
 * @param opts - Common method options
 */
export function createMethodRuntime(opts: AuthMethodOptions = {}): {
  readonly sessions: SessionStore;
  readonly crypto: SessionCrypto;
  now(): number;
} {
  const active = getActiveGateAuthContext();
  const sessions = opts.sessions ?? active?.sessions ?? createSessionStore();
  const now = opts.now ?? active?.now ?? (() => Date.now());
  return {
    sessions,
    now,
    crypto: {
      secret: resolveMethodSecret(opts),
      now,
    },
  };
}

/**
 * Public + rate gate chain for credential-ish auth paths.
 *
 * @param kind - Preset key
 */
export function authPublicGates(kind: keyof typeof AUTH_RATE_PRESETS = "otp"): GateDecl[] {
  const preset = AUTH_RATE_PRESETS[kind];
  return [
    gate.public,
    gate.rate({
      max: preset.max,
      per: preset.per,
      keyBy: preset.keyBy,
      description: `Auth ${kind} rate limit`,
    }),
  ];
}

/**
 * Bind a public auth Flow under `/auth/...`.
 *
 * @param path - Path under `/auth` (e.g. `/sign-in/username`)
 * @param flowDef - Flow
 * @param kind - Rate preset
 */
export function bindPublicAuth(
  path: string,
  flowDef: AnyFlowDef,
  kind: keyof typeof AUTH_RATE_PRESETS = "otp",
): Binding {
  const gates = authPublicGates(kind);
  let trigger = http.post(`/auth${path}`);
  for (const g of gates) trigger = trigger.gate(g);
  return bindAuthHttp(trigger, flowDef);
}

/**
 * Bind a session-gated auth Flow under `/auth/...`.
 *
 * @param path - Path under `/auth`
 * @param flowDef - Flow
 */
export function bindSessionAuth(path: string, flowDef: AnyFlowDef): Binding {
  return bindAuthHttp(http.post(`/auth${path}`).gate(AUTH_SESSION_GATE), flowDef);
}

export { AUTH_SESSION_GATE, fail, flow, http, z };
