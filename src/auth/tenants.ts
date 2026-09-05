/**
 * Built-in tenant registry + N:N membership + tenant-scoped roles.
 *
 * Opt-in via `gate.auth.tenant`. Not an organizations product — no
 * invitations UI, billing, or admin portal.
 */

import { isApplicationScope } from "../elements/gate/permissions.ts";
import type { TenantMemberRow, TenantRoleRow, TenantRow } from "./tables.ts";
import { okid } from "../okid.ts";

export type { TenantMemberRow, TenantRoleRow, TenantRow };

/** Capability / Manifest resource for `fx.auth` tenant methods. */
export const AUTH_TENANTS_RESOURCE = "auth:tenants";

/** Tenant registry / membership / role error. */
export class TenantError extends Error {
  readonly reason: string;
  readonly scope?: string;

  /**
   * @param reason - Stable reason token
   * @param message - Diagnostic
   * @param scope - Illegal scope name when `unknown_scope`
   */
  constructor(reason: string, message: string, scope?: string) {
    super(message);
    this.name = "TenantError";
    this.reason = reason;
    if (scope !== undefined) this.scope = scope;
  }
}

/** Default member role name until a mapping exists. */
export const DEFAULT_TENANT_ROLE = "member";

/** Lifecycle hooks for Clock per-tenant row expansion. */
export interface TenantStoreHooks {
  readonly onCreate?: (tenant: TenantRow) => void | Promise<void>;
  readonly onDelete?: (tenant: TenantRow) => void | Promise<void>;
}

/** In-memory tenant store. */
export interface TenantStore {
  tenants: Map<string, TenantRow>;
  members: Map<string, TenantMemberRow>;
  roles: Map<string, TenantRoleRow>;
  hooks?: TenantStoreHooks;
}

/**
 * Create an empty tenant store.
 *
 * @param hooks - Optional create/delete hooks (Clock expansion)
 */
export function createTenantStore(hooks?: TenantStoreHooks): TenantStore {
  return {
    tenants: new Map(),
    members: new Map(),
    roles: new Map(),
    ...(hooks !== undefined ? { hooks } : {}),
  };
}

function memberKey(tenantId: string, userId: string): string {
  return `${tenantId}:${userId}`;
}

function roleKey(tenantId: string, roleName: string): string {
  return `${tenantId}:${roleName}`;
}

/** Public tenant row returned by `fx.auth.listTenants`. */
export interface TenantPublicRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string | null;
  readonly role: string;
}

/** Options for {@link createTenant}. */
export interface CreateTenantOptions {
  readonly name: string;
  readonly createdBy: string;
  readonly slug?: string | null;
  readonly id?: string;
  readonly now?: () => number;
}

/**
 * Create a tenant and add the creator as a member.
 *
 * @param store - Tenant store
 * @param options - Name / creator / optional id
 */
export async function createTenant(
  store: TenantStore,
  options: CreateTenantOptions,
): Promise<TenantRow> {
  const now = options.now ?? (() => Date.now());
  const t = now();
  const id = options.id ?? okid();
  if (store.tenants.has(id)) {
    throw new TenantError("tenant_exists", `tenant already exists: ${id}`);
  }
  const slug = options.slug ?? null;
  if (slug) {
    for (const row of store.tenants.values()) {
      if (row.slug === slug) {
        throw new TenantError("slug_taken", `tenant slug already taken: ${slug}`);
      }
    }
  }
  const row: TenantRow = {
    id,
    name: options.name,
    slug,
    createdAt: t,
    createdBy: options.createdBy,
  };
  store.tenants.set(id, row);
  addMember(store, {
    tenantId: id,
    userId: options.createdBy,
    role: DEFAULT_TENANT_ROLE,
    now,
  });
  await store.hooks?.onCreate?.(row);
  return row;
}

/**
 * Delete a tenant, its memberships, and its custom roles.
 *
 * @param store - Tenant store
 * @param id - Tenant id
 */
export async function deleteTenant(store: TenantStore, id: string): Promise<TenantRow | undefined> {
  const row = store.tenants.get(id);
  if (!row) return undefined;
  store.tenants.delete(id);
  for (const [key, member] of [...store.members.entries()]) {
    if (member.tenantId === id) store.members.delete(key);
  }
  for (const [key, role] of [...store.roles.entries()]) {
    if (role.tenantId === id) store.roles.delete(key);
  }
  await store.hooks?.onDelete?.(row);
  return row;
}

/** Options for {@link addMember}. */
export interface AddMemberOptions {
  readonly tenantId: string;
  readonly userId: string;
  readonly role?: string;
  readonly id?: string;
  readonly now?: () => number;
}

/**
 * Add a membership (idempotent on tenant+user).
 *
 * @param store - Tenant store
 * @param options - Membership fields
 */
export function addMember(store: TenantStore, options: AddMemberOptions): TenantMemberRow {
  if (!store.tenants.has(options.tenantId)) {
    throw new TenantError("unknown_tenant", `unknown tenant: ${options.tenantId}`);
  }
  const key = memberKey(options.tenantId, options.userId);
  const existing = store.members.get(key);
  if (existing) {
    if (options.role !== undefined && options.role !== existing.role) {
      const next: TenantMemberRow = { ...existing, role: options.role };
      store.members.set(key, next);
      return next;
    }
    return existing;
  }
  const now = options.now ?? (() => Date.now());
  const row: TenantMemberRow = {
    id: options.id ?? okid(),
    tenantId: options.tenantId,
    userId: options.userId,
    role: options.role ?? DEFAULT_TENANT_ROLE,
    createdAt: now(),
  };
  store.members.set(key, row);
  return row;
}

/**
 * Remove a membership.
 *
 * @param store - Tenant store
 * @param tenantId - Tenant id
 * @param userId - User id
 */
export function removeMember(
  store: TenantStore,
  tenantId: string,
  userId: string,
): TenantMemberRow | undefined {
  const key = memberKey(tenantId, userId);
  const row = store.members.get(key);
  if (!row) return undefined;
  store.members.delete(key);
  return row;
}

/**
 * Look up one membership.
 *
 * @param store - Tenant store
 * @param tenantId - Tenant id
 * @param userId - User id
 */
export function getMember(
  store: TenantStore,
  tenantId: string,
  userId: string,
): TenantMemberRow | undefined {
  return store.members.get(memberKey(tenantId, userId));
}

/**
 * Whether `userId` is a member of `tenantId`.
 *
 * @param store - Tenant store
 * @param tenantId - Tenant id
 * @param userId - User id
 */
export function isMember(store: TenantStore, tenantId: string, userId: string): boolean {
  return store.members.has(memberKey(tenantId, userId));
}

/**
 * List memberships for a user (for `listTenants`).
 *
 * @param store - Tenant store
 * @param userId - User id
 */
export function listTenantsForUser(store: TenantStore, userId: string): TenantPublicRow[] {
  const out: TenantPublicRow[] = [];
  for (const member of store.members.values()) {
    if (member.userId !== userId) continue;
    const tenant = store.tenants.get(member.tenantId);
    if (!tenant) continue;
    out.push({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      role: member.role,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * List members of a tenant.
 *
 * @param store - Tenant store
 * @param tenantId - Tenant id
 */
export function listMembers(store: TenantStore, tenantId: string): TenantMemberRow[] {
  const out: TenantMemberRow[] = [];
  for (const member of store.members.values()) {
    if (member.tenantId === tenantId) out.push(member);
  }
  return out.sort((a, b) => a.userId.localeCompare(b.userId));
}

/**
 * All tenant ids currently in the store (Clock reconcile expansion).
 *
 * @param store - Tenant store
 */
export function listTenantIds(store: TenantStore): string[] {
  return [...store.tenants.keys()].sort();
}

/** Options for {@link upsertTenantRole}. */
export interface UpsertTenantRoleOptions {
  readonly tenantId: string;
  readonly roleName: string;
  readonly scopes: readonly string[];
  readonly catalog: readonly string[];
  readonly now?: () => number;
}

/**
 * Validate scopes against the Manifest-derived **user-plane** catalog.
 *
 * Unknown names and `console:*` / `console:…` fail the same way.
 *
 * @param scopes - Requested scope names
 * @param catalog - `deriveModuleActions(manifest)`
 * @returns Failure when any name is illegal; `null` when all are grantable
 */
export function tenantRoleScopeFailure(
  scopes: readonly string[],
  catalog: readonly string[],
): TenantError | null {
  const allowed = new Set(catalog.filter(isApplicationScope));
  for (const scope of scopes) {
    if (!allowed.has(scope)) {
      return new TenantError("unknown_scope", `unknown or operator-plane scope: ${scope}`, scope);
    }
  }
  return null;
}

/**
 * Create or replace a tenant role mapping.
 *
 * @param store - Tenant store
 * @param options - Role + catalog
 */
export function upsertTenantRole(
  store: TenantStore,
  options: UpsertTenantRoleOptions,
): TenantRoleRow {
  if (!store.tenants.has(options.tenantId)) {
    throw new TenantError("unknown_tenant", `unknown tenant: ${options.tenantId}`);
  }
  const denied = tenantRoleScopeFailure(options.scopes, options.catalog);
  if (denied) throw denied;
  const now = options.now ?? (() => Date.now());
  const t = now();
  const key = roleKey(options.tenantId, options.roleName);
  const prev = store.roles.get(key);
  const row: TenantRoleRow = {
    tenantId: options.tenantId,
    roleName: options.roleName,
    scopes: [...options.scopes],
    createdAt: prev?.createdAt ?? t,
    updatedAt: t,
  };
  store.roles.set(key, row);
  return row;
}

/**
 * Expand a member's tenant role into application scopes.
 *
 * @param store - Tenant store
 * @param tenantId - Tenant id
 * @param userId - User id
 */
export function tenantScopesForMember(
  store: TenantStore,
  tenantId: string,
  userId: string,
): readonly string[] {
  const member = getMember(store, tenantId, userId);
  if (!member) return [];
  const role = store.roles.get(roleKey(tenantId, member.role));
  return role?.scopes ?? [];
}
