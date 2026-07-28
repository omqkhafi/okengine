/**
 * Roles are data — any Module:Action set can be assigned without redeploy.
 *
 * @see docs/spec/console.md §3.2
 */

import type { AuthPlane } from "./planes.ts";
import type { RoleGrantRow, RoleRow } from "./tables.ts";

/** In-memory role store for tests / builtin auth. */
export interface RoleStore {
  roles: Map<string, RoleRow>;
  grants: Map<string, Set<string>>;
}

/**
 * Create an empty role store.
 */
export function createRoleStore(): RoleStore {
  return { roles: new Map(), grants: new Map() };
}

/**
 * Upsert a role (data, not code).
 *
 * @param store - Role store
 * @param role - Role row
 */
export function upsertRole(store: RoleStore, role: RoleRow): void {
  store.roles.set(role.id, role);
  if (!store.grants.has(role.id)) store.grants.set(role.id, new Set());
}

/**
 * Replace grants for a role with Module:Action pairs.
 *
 * @param store - Role store
 * @param roleId - Role id
 * @param actions - Module:Action pairs
 */
export function setRoleGrants(store: RoleStore, roleId: string, actions: readonly string[]): void {
  if (!store.roles.has(roleId)) {
    throw new Error(`unknown role: ${roleId}`);
  }
  store.grants.set(roleId, new Set(actions));
}

/**
 * Resolve the union of Module:Action scopes for role ids on a plane.
 *
 * @param store - Role store
 * @param roleIds - Role ids
 * @param plane - Plane filter (roles from the other plane are ignored)
 */
export function scopesForRoles(
  store: RoleStore,
  roleIds: readonly string[],
  plane: AuthPlane,
): Set<string> {
  const scopes = new Set<string>();
  for (const id of roleIds) {
    const role = store.roles.get(id);
    if (!role || role.plane !== plane) continue;
    for (const a of store.grants.get(id) ?? []) scopes.add(a);
  }
  return scopes;
}

/**
 * Snapshot grants as rows.
 *
 * @param store - Role store
 */
export function listRoleGrants(store: RoleStore): RoleGrantRow[] {
  const out: RoleGrantRow[] = [];
  for (const [roleId, actions] of store.grants) {
    for (const action of actions) out.push({ roleId, action });
  }
  return out;
}
