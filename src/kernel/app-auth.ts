/**
 * Sync auth wiring for `oke({ gate: { auth } })`.
 *
 * Loaded only when auth is configured so HTTP-only cold graphs never import
 * bindings / sessions / identity (`requirePackageModule` in `app.ts`).
 */

import type { ResolvedGateAuth } from "../auth/config.ts";
import { auth as authPlugin } from "../auth/plugin.ts";
import { createAuthHttpBindings, type AuthHttpMaterialization } from "../auth/bindings.ts";
import { tokenFromCookieHeader } from "../auth/cookies.ts";
import { setActiveGateAuthContext } from "../auth/method-context.ts";
import type { ResolvedGateConfig } from "../elements/gate/config.ts";
import {
  createAppAuthBinding,
  verifyBearerOrApiKey,
  verifyBearerToken,
  type AppAuthBinding,
} from "./auth-resolve.ts";
import type { PluginDef } from "./plugin.ts";

/** Result of wiring Gate auth at construction. */
export interface WiredGateAuth {
  readonly materialization: AuthHttpMaterialization | undefined;
  readonly authPlugin: PluginDef | undefined;
  readonly authBinding: AppAuthBinding;
  readonly verifyBearerToken: typeof verifyBearerToken;
  readonly verifyBearerOrApiKey: typeof verifyBearerOrApiKey;
  readonly tokenFromCookieHeader: typeof tokenFromCookieHeader;
  /** Rebuild binding when boot supplies a clock. */
  rebind(now: () => number): AppAuthBinding;
}

/** Options for {@link wireGateAuth}. */
export interface WireGateAuthOptions {
  readonly gateConfig: ResolvedGateConfig & { readonly auth: ResolvedGateAuth };
  /** Clock fallback when `gate.auth.now` is omitted (`oke({ fx: { now } })`). */
  readonly now?: () => number;
}

/**
 * Materialize auth HTTP bindings, absorb the builtin auth plugin, and publish
 * the active Gate auth context for `.plug(username())` etc.
 *
 * @param options - Resolved Gate bag + optional clock
 */
export function wireGateAuth(options: WireGateAuthOptions): WiredGateAuth {
  const { gateConfig } = options;
  const auth = gateConfig.auth;
  let materialization: AuthHttpMaterialization | undefined;
  if (auth.http) {
    materialization = createAuthHttpBindings(auth, {
      rateLimitEnabled: gateConfig.rateLimitEnabled,
      sessions: auth.sessions,
    });
  }

  const pluginDef = authPlugin({
    secret: auth.secret,
    accessTtlMs: auth.session.accessTtlMs,
    refreshTtlMs: auth.session.refreshTtlMs,
    session: {
      accessTtlMs: auth.session.accessTtlMs,
      refreshTtlMs: auth.session.refreshTtlMs,
      idleTtlMs: auth.session.idleTtlMs,
      absoluteTtlMs: auth.session.absoluteTtlMs,
      singleSessionPerUser: auth.session.singleSessionPerUser,
    },
    password: auth.password,
    passwordPolicy: auth.passwordPolicy,
    breachCheck: auth.breachCheck,
  });

  let authBinding = createAppAuthBinding({
    secret: auth.secret,
    sessions: materialization?.ctx.sessions ?? auth.sessions,
    now: auth.now ?? options.now,
  });

  setActiveGateAuthContext({
    secret: authBinding.secret,
    sessions: authBinding.sessions,
    identities: auth.identities,
    now: authBinding.now,
    passwordPolicy: auth.passwordPolicy,
    password: auth.password,
    breachCheck: auth.breachCheck,
  });

  return {
    materialization,
    authPlugin: pluginDef,
    authBinding,
    verifyBearerToken,
    verifyBearerOrApiKey,
    tokenFromCookieHeader,
    rebind(now) {
      authBinding = createAppAuthBinding({
        secret: authBinding.secret,
        sessions: authBinding.sessions,
        now,
      });
      return authBinding;
    },
  };
}
