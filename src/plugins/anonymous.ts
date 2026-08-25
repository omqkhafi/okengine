/**
 * Anonymous sign-in Gate auth method plugin.
 */

import { IdentityError, linkOrProvision } from "../auth/identity.ts";
import { issueSessionWithScopes } from "../auth/sessions.ts";
import { plugin, type PluginDef } from "../kernel/plugin.ts";
import {
  AuthFailed,
  AuthRateLimited,
  SessionTokensOut,
  bindPublicAuth,
  createMethodRuntime,
  fail,
  flow,
  resolveSharedIdentities,
  type AuthMethodOptions,
} from "./auth/shared.ts";

/** Options for {@link anonymous}. */
export interface AnonymousPluginOptions extends AuthMethodOptions {
  /**
   * Reserved for future disposable emails (`user@domain`). Unused in v1.
   */
  readonly emailDomain?: string;
}

/**
 * Issue a user-plane session with a random principal id (no password).
 *
 * @param opts - Secret / session overrides
 */
export function anonymous(opts: AnonymousPluginOptions = {}): PluginDef {
  const runtime = createMethodRuntime(opts);
  const identities = resolveSharedIdentities(opts);

  const signIn = flow("auth.signInAnonymous", {
    plane: "user",
    out: SessionTokensOut,
    errors: { AuthFailed, AuthRateLimited },
    do: async () => {
      let userId: string;
      try {
        userId = (
          await linkOrProvision(identities, {
            provider: "anonymous",
            providerAccountId: crypto.randomUUID(),
            now: runtime.now,
          })
        ).user.id;
      } catch (err) {
        if (err instanceof IdentityError) {
          return fail("AuthFailed", { reason: "invalid_credentials" });
        }
        throw err;
      }
      const issued = await issueSessionWithScopes(runtime.sessions, runtime.crypto, {
        id: userId,
        plane: "user",
        scopes: [],
      });
      return {
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        accessExpiresAt: issued.accessExpiresAt,
        userId,
      };
    },
  });

  return plugin("anonymous", { version: "0.0.1", config: { method: "anonymous" } })
    .needs("auth")
    .binding(bindPublicAuth("/sign-in/anonymous", signIn, "signIn"));
}
