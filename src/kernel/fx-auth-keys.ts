/**
 * `fx.auth` key-management methods — session-only, attenuated, one store.
 */

import {
  AUTH_API_KEYS_RESOURCE,
  createApiKey,
  getApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  toApiKeyPublicRow,
  updateApiKey,
  type ApiKeyPublicRow,
  type ApiKeyStore,
  type CreatedApiKey,
} from "../auth/api-keys.ts";
import { parseDurationMs } from "../elements/clock/duration.ts";
import { fail, type FlowFailure } from "./errors.ts";

/**
 * Identity bag on {@link FxAuth} before key-management methods attach.
 * Passed into {@link createFx} / {@link attachAuthKeyMethods}.
 */
export interface FxAuthIdentity {
  /** User-plane subject id, or null when unauthenticated. */
  readonly userId: string | null;
  /** Granted scopes for the live principal. */
  readonly scopes: ReadonlySet<string>;
  /** Whether the identity has completed verification (email / MFA). */
  readonly verified?: boolean;
  /** Authenticating API key id when Bearer was a key secret; otherwise null. */
  readonly apiKeyId?: string | null;
}

/** Options for {@link FxAuth.createApiKey}. */
export interface FxCreateApiKeyInput {
  readonly name: string;
  readonly scopes: readonly string[];
  readonly expiresIn?: string;
  readonly ipAllowlist?: readonly string[];
  readonly rateLimit?: { max: number; per: string } | null;
}

/** Options for {@link FxAuth.updateApiKey}. */
export interface FxUpdateApiKeyInput {
  readonly name?: string;
  readonly scopes?: readonly string[];
  readonly expiresIn?: string;
  readonly ipAllowlist?: readonly string[];
  readonly rateLimit?: { max: number; per: string } | null;
}

/** Create result for `fx.auth.createApiKey` / `rotateApiKey`. */
export interface FxCreatedApiKey {
  readonly key: ApiKeyPublicRow;
  readonly secret: string;
}

/**
 * Session-only key management attached onto {@link FxAuthIdentity}.
 * Methods throw {@link FlowFailure} values (`Unauthorized` / `Forbidden`).
 */
export interface FxAuthKeyMethods {
  createApiKey(input: FxCreateApiKeyInput): Promise<FxCreatedApiKey>;
  listApiKeys(): Promise<readonly ApiKeyPublicRow[]>;
  revokeApiKey(id: string): Promise<ApiKeyPublicRow>;
  rotateApiKey(id: string): Promise<FxCreatedApiKey>;
  updateApiKey(id: string, input: FxUpdateApiKeyInput): Promise<ApiKeyPublicRow>;
}

/** Dependencies for {@link attachAuthKeyMethods}. */
export interface AttachAuthKeyMethodsOptions {
  readonly auth: FxAuthIdentity;
  readonly store: ApiKeyStore | undefined;
  readonly now: () => number;
  readonly gated: <T>(
    kind: "read" | "write",
    resource: string,
    body: () => T | Promise<T>,
  ) => Promise<T>;
}

function sessionOnly(auth: FxAuthIdentity): FlowFailure | null {
  if (auth.apiKeyId) {
    return fail("Forbidden", { gate: AUTH_API_KEYS_RESOURCE, reason: "session_only" });
  }
  if (!auth.userId) {
    return fail("Unauthorized", {});
  }
  return null;
}

function requireStore(store: ApiKeyStore | undefined): ApiKeyStore {
  if (!store) {
    throw fail("Forbidden", { gate: AUTH_API_KEYS_RESOURCE, reason: "no_store" });
  }
  return store;
}

function requireOwned(
  store: ApiKeyStore,
  id: string,
  userId: string,
): ReturnType<typeof getApiKey> {
  const row = getApiKey(store, id);
  if (!row || row.creatorId !== userId) {
    throw fail("Forbidden", { gate: AUTH_API_KEYS_RESOURCE, reason: "not_owner" });
  }
  return row;
}

function expiresAtFrom(expiresIn: string | undefined, now: () => number): number | undefined {
  if (expiresIn === undefined) return undefined;
  return now() + parseDurationMs(expiresIn);
}

/**
 * Attach create / list / revoke / rotate / update onto a live identity bag.
 *
 * @param options - Auth bag + store + capability gate
 */
export function attachAuthKeyMethods(
  options: AttachAuthKeyMethodsOptions,
): FxAuthIdentity & FxAuthKeyMethods {
  const { auth, now, gated } = options;

  const methods: FxAuthKeyMethods = {
    createApiKey(input) {
      return gated("write", AUTH_API_KEYS_RESOURCE, async () => {
        const denied = sessionOnly(auth);
        if (denied) throw denied;
        const store = requireStore(options.store);
        const created: CreatedApiKey = await createApiKey(store, {
          plane: "user",
          name: input.name,
          scopes: input.scopes,
          creatorId: auth.userId!,
          creatorScopes: auth.scopes,
          expiresAt: expiresAtFrom(input.expiresIn, now) ?? null,
          rateLimit: input.rateLimit ?? null,
          ipAllowlist: input.ipAllowlist,
          now,
        });
        return { key: toApiKeyPublicRow(created.row), secret: created.secret };
      });
    },
    listApiKeys() {
      return gated("read", AUTH_API_KEYS_RESOURCE, async () => {
        const denied = sessionOnly(auth);
        if (denied) throw denied;
        const store = requireStore(options.store);
        return listApiKeys(store, auth.userId!).map(toApiKeyPublicRow);
      });
    },
    revokeApiKey(id) {
      return gated("write", AUTH_API_KEYS_RESOURCE, async () => {
        const denied = sessionOnly(auth);
        if (denied) throw denied;
        const store = requireStore(options.store);
        requireOwned(store, id, auth.userId!);
        const row = revokeApiKey(store, id, now);
        if (!row) throw fail("Forbidden", { gate: AUTH_API_KEYS_RESOURCE, reason: "not_owner" });
        return toApiKeyPublicRow(row);
      });
    },
    rotateApiKey(id) {
      return gated("write", AUTH_API_KEYS_RESOURCE, async () => {
        const denied = sessionOnly(auth);
        if (denied) throw denied;
        const store = requireStore(options.store);
        requireOwned(store, id, auth.userId!);
        const rotated = await rotateApiKey(store, id, { now });
        if (!rotated)
          throw fail("Forbidden", { gate: AUTH_API_KEYS_RESOURCE, reason: "not_owner" });
        return { key: toApiKeyPublicRow(rotated.row), secret: rotated.secret };
      });
    },
    updateApiKey(id, input) {
      return gated("write", AUTH_API_KEYS_RESOURCE, async () => {
        const denied = sessionOnly(auth);
        if (denied) throw denied;
        const store = requireStore(options.store);
        const existing = requireOwned(store, id, auth.userId!);
        if (!existing)
          throw fail("Forbidden", { gate: AUTH_API_KEYS_RESOURCE, reason: "not_owner" });
        const ceiling = new Set([...existing.creatorScopes].filter((s) => auth.scopes.has(s)));
        const row = updateApiKey(store, id, {
          ceiling,
          name: input.name,
          scopes: input.scopes,
          expiresAt: expiresAtFrom(input.expiresIn, now),
          rateLimit: input.rateLimit,
          ipAllowlist: input.ipAllowlist,
        });
        if (!row) throw fail("Forbidden", { gate: AUTH_API_KEYS_RESOURCE, reason: "not_owner" });
        return toApiKeyPublicRow(row);
      });
    },
  };

  return Object.assign(auth, methods);
}
