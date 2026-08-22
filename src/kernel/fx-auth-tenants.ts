/**
 * `fx.auth` tenant methods — session-only, lazy-attached like API keys.
 */

import {
  AUTH_TENANTS_RESOURCE,
  addMember,
  createTenant,
  deleteTenant,
  isMember,
  listMembers,
  listTenantsForUser,
  removeMember,
  TenantError,
  upsertTenantRole,
  type TenantMemberRow,
  type TenantPublicRow,
  type TenantRoleRow,
  type TenantRow,
  type TenantStore,
} from "../auth/tenants.ts";
import {
  issueSession,
  type IssuedSession,
  type SessionCrypto,
  type SessionStore,
} from "../auth/sessions.ts";
import type { Manifest } from "../manifest/types.ts";
import { deriveModuleActions } from "../elements/gate/permissions.ts";
import type { EffectKind } from "./effects.ts";
import { fail, type FlowFailure } from "./errors.ts";
import type { FxAuthIdentity } from "./fx-auth-keys.ts";

/** Options for {@link FxAuth.createTenant}. */
export interface FxCreateTenantInput {
  readonly name: string;
  readonly slug?: string | null;
  readonly id?: string;
}

/** Options for {@link FxAuth.addMember}. */
export interface FxAddMemberInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly role?: string;
}

/** Options for {@link FxAuth.upsertTenantRole}. */
export interface FxUpsertTenantRoleInput {
  readonly tenantId: string;
  readonly roleName: string;
  readonly scopes: readonly string[];
}

/**
 * Session-only tenant primitives attached onto {@link FxAuthIdentity}.
 */
export interface FxAuthTenantMethods {
  listTenants(): Promise<readonly TenantPublicRow[]>;
  switchTenant(id: string): Promise<IssuedSession>;
  createTenant(input: FxCreateTenantInput): Promise<TenantRow>;
  deleteTenant(id: string): Promise<TenantRow>;
  addMember(input: FxAddMemberInput): Promise<TenantMemberRow>;
  removeMember(tenantId: string, userId: string): Promise<TenantMemberRow>;
  listMembers(tenantId: string): Promise<readonly TenantMemberRow[]>;
  upsertTenantRole(input: FxUpsertTenantRoleInput): Promise<TenantRoleRow>;
}

/** Dependencies for {@link attachTenantMethods}. */
export interface AttachAuthTenantMethodsOptions {
  readonly auth: FxAuthIdentity;
  readonly store: TenantStore | undefined;
  readonly sessions: SessionStore | undefined;
  readonly crypto: SessionCrypto | undefined;
  readonly manifest: Manifest | undefined;
  readonly now: () => number;
  readonly gated: <T>(kind: EffectKind, resource: string, body: () => T | Promise<T>) => Promise<T>;
}

function sessionOnly(auth: FxAuthIdentity): FlowFailure | null {
  if (auth.apiKeyId) {
    return fail("Forbidden", { gate: AUTH_TENANTS_RESOURCE, reason: "session_only" });
  }
  if (!auth.userId) {
    return fail("Unauthorized", {});
  }
  return null;
}

function requireStore(store: TenantStore | undefined): TenantStore {
  if (!store) {
    throw fail("Forbidden", { gate: AUTH_TENANTS_RESOURCE, reason: "no_store" });
  }
  return store;
}

function mapTenantError(err: unknown): never {
  if (err instanceof TenantError) {
    throw fail("Forbidden", {
      gate: AUTH_TENANTS_RESOURCE,
      reason: err.reason,
      ...(err.scope !== undefined ? { scope: err.scope } : {}),
    });
  }
  throw err;
}

/**
 * Attach tenant primitives onto a live identity bag.
 *
 * @param options - Auth bag + tenant store + session crypto
 */
export function attach(
  options: AttachAuthTenantMethodsOptions,
): FxAuthIdentity & FxAuthTenantMethods {
  const { auth, now, gated } = options;

  const methods: FxAuthTenantMethods = {
    listTenants() {
      return gated("read", AUTH_TENANTS_RESOURCE, async () => {
        const denied = sessionOnly(auth);
        if (denied) throw denied;
        const store = requireStore(options.store);
        return listTenantsForUser(store, auth.userId!);
      });
    },
    switchTenant(id) {
      return gated("write", AUTH_TENANTS_RESOURCE, async () => {
        const denied = sessionOnly(auth);
        if (denied) throw denied;
        const store = requireStore(options.store);
        if (!isMember(store, id, auth.userId!)) {
          throw fail("Forbidden", { gate: AUTH_TENANTS_RESOURCE, reason: "not_member" });
        }
        const sessions = options.sessions;
        const crypto = options.crypto;
        if (!sessions || !crypto) {
          throw fail("Forbidden", { gate: AUTH_TENANTS_RESOURCE, reason: "no_sessions" });
        }
        // New family — tab A rotation cannot reuse-detect tab B.
        // Mint from session scopes, never the live tenant-unioned set.
        const minted = auth.sessionScopes ?? auth.scopes;
        return issueSession(sessions, crypto, {
          id: auth.userId!,
          plane: "user",
          scopes: [...minted],
          tenantId: id,
        });
      });
    },
    createTenant(input) {
      return gated("write", AUTH_TENANTS_RESOURCE, async () => {
        const denied = sessionOnly(auth);
        if (denied) throw denied;
        const store = requireStore(options.store);
        try {
          return await createTenant(store, {
            name: input.name,
            createdBy: auth.userId!,
            ...(input.slug !== undefined ? { slug: input.slug } : {}),
            ...(input.id !== undefined ? { id: input.id } : {}),
            now,
          });
        } catch (err) {
          mapTenantError(err);
        }
      });
    },
    deleteTenant(id) {
      return gated("write", AUTH_TENANTS_RESOURCE, async () => {
        const denied = sessionOnly(auth);
        if (denied) throw denied;
        const store = requireStore(options.store);
        if (!isMember(store, id, auth.userId!)) {
          throw fail("Forbidden", { gate: AUTH_TENANTS_RESOURCE, reason: "not_member" });
        }
        const row = await deleteTenant(store, id);
        if (!row) {
          throw fail("Forbidden", { gate: AUTH_TENANTS_RESOURCE, reason: "unknown_tenant" });
        }
        return row;
      });
    },
    addMember(input) {
      return gated("write", AUTH_TENANTS_RESOURCE, async () => {
        const denied = sessionOnly(auth);
        if (denied) throw denied;
        const store = requireStore(options.store);
        if (!isMember(store, input.tenantId, auth.userId!)) {
          throw fail("Forbidden", { gate: AUTH_TENANTS_RESOURCE, reason: "not_member" });
        }
        try {
          return addMember(store, {
            tenantId: input.tenantId,
            userId: input.userId,
            ...(input.role !== undefined ? { role: input.role } : {}),
            now,
          });
        } catch (err) {
          mapTenantError(err);
        }
      });
    },
    removeMember(tenantId, userId) {
      return gated("write", AUTH_TENANTS_RESOURCE, async () => {
        const denied = sessionOnly(auth);
        if (denied) throw denied;
        const store = requireStore(options.store);
        if (!isMember(store, tenantId, auth.userId!)) {
          throw fail("Forbidden", { gate: AUTH_TENANTS_RESOURCE, reason: "not_member" });
        }
        const row = removeMember(store, tenantId, userId);
        if (!row) {
          throw fail("Forbidden", { gate: AUTH_TENANTS_RESOURCE, reason: "not_member" });
        }
        return row;
      });
    },
    listMembers(tenantId) {
      return gated("read", AUTH_TENANTS_RESOURCE, async () => {
        const denied = sessionOnly(auth);
        if (denied) throw denied;
        const store = requireStore(options.store);
        if (!isMember(store, tenantId, auth.userId!)) {
          throw fail("Forbidden", { gate: AUTH_TENANTS_RESOURCE, reason: "not_member" });
        }
        return listMembers(store, tenantId);
      });
    },
    upsertTenantRole(input) {
      return gated("write", AUTH_TENANTS_RESOURCE, async () => {
        const denied = sessionOnly(auth);
        if (denied) throw denied;
        const store = requireStore(options.store);
        if (!isMember(store, input.tenantId, auth.userId!)) {
          throw fail("Forbidden", { gate: AUTH_TENANTS_RESOURCE, reason: "not_member" });
        }
        const catalog = options.manifest ? deriveModuleActions(options.manifest) : [];
        try {
          return upsertTenantRole(store, {
            tenantId: input.tenantId,
            roleName: input.roleName,
            scopes: input.scopes,
            catalog,
            now,
          });
        } catch (err) {
          mapTenantError(err);
        }
      });
    },
  };

  return Object.assign(auth, methods);
}

/**
 * Compact attach from `createFx` so Store-only graphs do not spell the
 * tenant store / session crypto field names.
 *
 * @param auth - Identity after API-key methods
 * @param options - createFx options bag
 * @param now - Clock
 * @param gated - Capability gate
 */
export function bind(
  auth: FxAuthIdentity,
  options: {
    readonly tenantStore?: TenantStore;
    readonly sessions?: SessionStore;
    readonly sessionCrypto?: SessionCrypto;
    readonly manifest?: Manifest;
  },
  now: () => number,
  gated: AttachAuthTenantMethodsOptions["gated"],
): FxAuthIdentity & FxAuthTenantMethods {
  return attach({
    auth,
    store: options.tenantStore,
    sessions: options.sessions,
    crypto: options.sessionCrypto,
    manifest: options.manifest ?? undefined,
    now,
    gated,
  });
}
