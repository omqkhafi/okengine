/**
 * Console Access projection — two planes, attenuation by absence,
 * effective permissions with provenance, revocation blast radius
 * (console §9.14).
 *
 * Grantable scopes are derived via {@link grantableScopes} /
 * {@link attenuateScopes} against an expanded ceiling — never a
 * hand-maintained allow-list in the UI.
 */

import {
  ACCESS_TTL_MS,
  assertAttenuated,
  createApiKey,
  createOperatorInvite,
  expandHeldScopes,
  grantableScopes,
  isInviteExpired,
  revokeApiKey,
  revokeFamily,
  rotateApiKey,
  setRoleGrants,
  scopesForRoles,
  type ApiKeyStore,
  type OperatorInviteStore,
  type OperatorStore,
  type RoleStore,
  type SessionStore,
} from "../../auth/index.ts";
import { deriveModuleActions } from "../../elements/gate.ts";
import type { Manifest } from "../../manifest/types.ts";
import type { WideEvent } from "../../runs/types.ts";
import { isApplicationScope } from "./gates.ts";

/** 90 days — hygiene threshold for unused keys. */
export const KEY_UNUSED_MS = 90 * 24 * 60 * 60 * 1000;

/** Identity slice for Access (user plane). */
export interface AccessIdentity {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: "active" | "disabled";
  readonly scopes: readonly string[];
}

/** Operator row for Access. */
export interface AccessOperatorRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: "active" | "suspended" | "invited";
  readonly roles: readonly string[];
  readonly scopes: readonly string[];
  readonly lastSeenAt: number | null;
  readonly neverSignedIn: boolean;
}

/** User-plane identity row. */
export interface AccessUserRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: "active" | "disabled";
  readonly roles: readonly string[];
  readonly scopes: readonly string[];
}

/** Role row with grants. */
export interface AccessRoleRow {
  readonly id: string;
  readonly name: string;
  readonly plane: "user" | "operator";
  readonly description: string;
  readonly scopes: readonly string[];
  readonly memberCount: number;
}

/** API key row (never includes the secret). */
export interface AccessKeyRow {
  readonly id: string;
  readonly name: string;
  readonly plane: "user" | "operator";
  readonly scopes: readonly string[];
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
  readonly expiresAt: number | null;
  readonly revokedAt: number | null;
  readonly rateLimit: { max: number; per: string } | null;
  readonly ipAllowlist: readonly string[];
  readonly unused90d: boolean;
}

/** Invitation row. */
export interface AccessInviteRow {
  readonly id: string;
  readonly email: string;
  readonly invitedBy: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly expired: boolean;
}

/** Provenance for one effective scope. */
export interface AccessScopeProvenance {
  readonly scope: string;
  /** Roles that grant this scope (`direct` for key-owned scopes). */
  readonly sources: readonly {
    readonly kind: "role" | "direct";
    readonly id: string;
    readonly name: string;
  }[];
}

/** Effective permissions for a principal. */
export interface AccessEffectivePermissions {
  readonly kind: "operator" | "user" | "role" | "key";
  readonly id: string;
  readonly plane: "user" | "operator";
  readonly scopes: readonly AccessScopeProvenance[];
}

/** Blast radius from Runs for key revoke/rotate. */
export interface AccessKeyBlastRadius {
  readonly callVolume: number;
  readonly lastUsedAt: number | null;
  readonly sourceAddresses: readonly string[];
  /** Access-token TTL from config (ms) — residual validity after revoke. */
  readonly accessTtlMs: number;
  /** Honest hybrid-session delay note. */
  readonly residualAccessNote: string;
}

/** Hygiene findings. */
export interface AccessHygiene {
  readonly unusedKeys: readonly AccessKeyRow[];
  readonly neverSignedInOperators: readonly AccessOperatorRow[];
  readonly expiredInvitations: readonly AccessInviteRow[];
}

/** One plane's Access surface — never merged with the other. */
export interface AccessPlaneSection {
  readonly plane: "user" | "operator";
  readonly operators?: readonly AccessOperatorRow[];
  readonly users?: readonly AccessUserRow[];
  readonly roles: readonly AccessRoleRow[];
  readonly keys: readonly AccessKeyRow[];
  readonly invites?: readonly AccessInviteRow[];
  /** Scopes the actor may grant on this plane (absence = impossible). */
  readonly grantableScopes: readonly string[];
}

/** Full Access panel projection. */
export interface AccessPanelProjection {
  readonly operatorPlane: AccessPlaneSection;
  readonly userPlane: AccessPlaneSection;
  readonly hygiene: AccessHygiene;
  readonly accessTtlMs: number;
  readonly catalog: readonly string[];
}

/** Options for {@link projectAccessPanel}. */
export interface ProjectAccessOptions {
  readonly manifest: Manifest | null;
  readonly roles: RoleStore;
  readonly apiKeys: ApiKeyStore;
  readonly operators: OperatorStore;
  readonly invites: OperatorInviteStore;
  readonly identities: readonly AccessIdentity[];
  /** roleId → member principal ids. */
  readonly roleMembers: ReadonlyMap<string, readonly string[]>;
  /** Acting operator's held scopes (session / roles). */
  readonly actorScopes: Iterable<string>;
  readonly accessTtlMs?: number;
  readonly now?: () => number;
}

/**
 * Project Access panel — planes kept separate; grantable via attenuation.
 *
 * @param options - Auth stores + actor ceiling
 */
export function projectAccessPanel(
  options: ProjectAccessOptions,
): AccessPanelProjection {
  const now = options.now ?? (() => Date.now());
  const accessTtlMs = options.accessTtlMs ?? ACCESS_TTL_MS;
  const catalog = options.manifest
    ? deriveModuleActions(options.manifest)
    : collectCatalogFromStores(options.roles, options.apiKeys);

  const planeOf = (scope: string): "user" | "operator" =>
    isApplicationScope(scope) ? "user" : "operator";

  const held = expandAccessCeiling(options.actorScopes, catalog);
  const grantableOperator = grantableScopes({
    held,
    catalog,
    planeOf,
    plane: "operator",
  });
  const grantableUser = grantableScopes({
    held,
    catalog,
    planeOf,
    plane: "user",
  });

  const operators = projectOperators(options);
  const users = projectUsers(options);
  const roles = projectRoles(options);
  const keys = projectKeys(options, now);
  const invites = projectInvites(options, now);

  const operatorPlane: AccessPlaneSection = {
    plane: "operator",
    operators,
    roles: roles.filter((r) => r.plane === "operator"),
    keys: keys.filter((k) => k.plane === "operator"),
    invites,
    grantableScopes: grantableOperator,
  };

  const userPlane: AccessPlaneSection = {
    plane: "user",
    users,
    roles: roles.filter((r) => r.plane === "user"),
    keys: keys.filter((k) => k.plane === "user"),
    grantableScopes: grantableUser,
  };

  const hygiene: AccessHygiene = {
    unusedKeys: keys.filter((k) => k.unused90d && k.revokedAt === null),
    neverSignedInOperators: operators.filter((o) => o.neverSignedIn),
    expiredInvitations: invites.filter((i) => i.expired),
  };

  return {
    operatorPlane,
    userPlane,
    hygiene,
    accessTtlMs,
    catalog,
  };
}

/**
 * Effective permissions with provenance — inverse of the Gates simulator.
 *
 * @param options - Principal + stores
 */
export function effectivePermissions(options: {
  readonly kind: "operator" | "user" | "role" | "key";
  readonly id: string;
  readonly roles: RoleStore;
  readonly apiKeys: ApiKeyStore;
  readonly operators: OperatorStore;
  readonly identities: readonly AccessIdentity[];
  readonly roleMembers: ReadonlyMap<string, readonly string[]>;
}): AccessEffectivePermissions | null {
  if (options.kind === "key") {
    const key = options.apiKeys.keys.get(options.id);
    if (!key) return null;
    return {
      kind: "key",
      id: key.id,
      plane: key.plane,
      scopes: [...key.scopes]
        .sort((a, b) => a.localeCompare(b))
        .map((scope) => ({
          scope,
          sources: [
            { kind: "direct" as const, id: key.id, name: key.name },
          ],
        })),
    };
  }

  if (options.kind === "role") {
    const role = options.roles.roles.get(options.id);
    if (!role) return null;
    const scopes = [...(options.roles.grants.get(role.id) ?? [])].sort((a, b) =>
      a.localeCompare(b),
    );
    return {
      kind: "role",
      id: role.id,
      plane: role.plane,
      scopes: scopes.map((scope) => ({
        scope,
        sources: [
          { kind: "role" as const, id: role.id, name: role.name },
        ],
      })),
    };
  }

  if (options.kind === "operator") {
    const op = options.operators.operators.get(options.id);
    if (!op) return null;
    const roleIds = options.operators.roles.get(options.id) ?? [];
    return {
      kind: "operator",
      id: op.id,
      plane: "operator",
      scopes: provenanceForRoles(options.roles, roleIds, "operator"),
    };
  }

  const identity = options.identities.find((i) => i.id === options.id);
  if (!identity) return null;
  const roleIds = roleIdsForMember(options.roleMembers, options.id);
  const fromRoles = provenanceForRoles(options.roles, roleIds, "user");
  // Identity may also carry direct scopes (dev seed) — mark as direct.
  const covered = new Set(fromRoles.map((s) => s.scope));
  const scopes = [...fromRoles];
  for (const scope of identity.scopes) {
    if (covered.has(scope)) continue;
    scopes.push({
      scope,
      sources: [
        { kind: "direct" as const, id: identity.id, name: identity.name },
      ],
    });
  }
  scopes.sort((a, b) => a.scope.localeCompare(b.scope));
  return {
    kind: "user",
    id: identity.id,
    plane: "user",
    scopes,
  };
}

/**
 * Blast radius for key revoke/rotate — queried from Runs, not guessed.
 *
 * @param options - Key id, runs, TTL config
 */
export function keyBlastRadius(options: {
  readonly keyId: string;
  readonly apiKeys: ApiKeyStore;
  readonly runs: readonly WideEvent[];
  readonly accessTtlMs?: number;
}): AccessKeyBlastRadius {
  const accessTtlMs = options.accessTtlMs ?? ACCESS_TTL_MS;
  const key = options.apiKeys.keys.get(options.keyId);
  const matching = options.runs.filter((r) => runTouchesKey(r, options.keyId));
  const addresses = new Set<string>();
  let lastUsedAt: number | null = key?.lastUsedAt ?? null;
  for (const run of matching) {
    if (lastUsedAt === null || run.startedAt > lastUsedAt) {
      lastUsedAt = run.startedAt;
    }
    const ip = sourceAddressOf(run);
    if (ip) addresses.add(ip);
  }
  return {
    callVolume: matching.length,
    lastUsedAt,
    sourceAddresses: [...addresses].sort((a, b) => a.localeCompare(b)),
    accessTtlMs,
    residualAccessNote: residualAccessNote(accessTtlMs),
  };
}

/**
 * Honest hybrid-session delay copy from the configured access TTL.
 *
 * @param accessTtlMs - Access-token TTL from config
 */
export function residualAccessNote(accessTtlMs: number): string {
  const minutes = Math.max(1, Math.ceil(accessTtlMs / 60_000));
  return `Existing access may continue up to ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** Input for creating a key through Access. */
export interface AccessCreateKeyInput {
  readonly plane: "user" | "operator";
  readonly name: string;
  readonly scopes: readonly string[];
  readonly creatorId: string;
  readonly creatorScopes: Iterable<string>;
  readonly catalog: readonly string[];
  readonly expiresAt?: number | null;
  readonly rateLimit?: { max: number; per: string } | null;
  readonly ipAllowlist?: readonly string[];
  readonly now?: () => number;
}

/**
 * Create a key — attenuation + plane absence enforced server-side.
 *
 * @param store - API key store
 * @param input - Create payload
 */
export async function accessCreateKey(
  store: ApiKeyStore,
  input: AccessCreateKeyInput,
): Promise<{ readonly row: AccessKeyRow; readonly secret: string }> {
  const planeOf = (scope: string): "user" | "operator" =>
    isApplicationScope(scope) ? "user" : "operator";
  const held = expandAccessCeiling(input.creatorScopes, input.catalog);
  const allowed = new Set(
    grantableScopes({
      held,
      catalog: input.catalog,
      planeOf,
      plane: input.plane,
    }),
  );
  for (const scope of input.scopes) {
    if (!allowed.has(scope)) {
      assertAttenuated(held, [scope], "api key");
      throw new AccessGrantError(
        `scope ${scope} is not grantable on the ${input.plane} plane`,
      );
    }
  }
  const created = await createApiKey(store, {
    plane: input.plane,
    name: input.name,
    scopes: input.scopes,
    creatorId: input.creatorId,
    creatorScopes: held,
    expiresAt: input.expiresAt,
    rateLimit: input.rateLimit,
    ipAllowlist: input.ipAllowlist,
    now: input.now,
  });
  return {
    row: toKeyRow(created.row, input.now ?? (() => Date.now())),
    secret: created.secret,
  };
}

/**
 * Set role grants — only grantable scopes on the role's plane.
 *
 * @param options - Role + requested scopes + actor ceiling
 */
export function accessSetRoleGrants(options: {
  readonly roles: RoleStore;
  readonly roleId: string;
  readonly scopes: readonly string[];
  readonly actorScopes: Iterable<string>;
  readonly catalog: readonly string[];
}): void {
  const role = options.roles.roles.get(options.roleId);
  if (!role) throw new AccessGrantError(`unknown role: ${options.roleId}`);
  const planeOf = (scope: string): "user" | "operator" =>
    isApplicationScope(scope) ? "user" : "operator";
  const held = expandAccessCeiling(options.actorScopes, options.catalog);
  const allowed = new Set(
    grantableScopes({
      held,
      catalog: options.catalog,
      planeOf,
      plane: role.plane,
    }),
  );
  for (const scope of options.scopes) {
    if (!allowed.has(scope)) {
      throw new AccessGrantError(
        `scope ${scope} is not grantable on the ${role.plane} plane`,
      );
    }
  }
  setRoleGrants(options.roles, options.roleId, options.scopes);
}

/**
 * Revoke a key and any session families bound to it.
 *
 * @param options - Stores + key id
 */
export function accessRevokeKey(options: {
  readonly apiKeys: ApiKeyStore;
  readonly sessions: SessionStore;
  readonly keyId: string;
  readonly now?: () => number;
}): AccessKeyRow | null {
  const now = options.now ?? (() => Date.now());
  const row = revokeApiKey(options.apiKeys, options.keyId, now);
  if (!row) return null;
  for (const session of options.sessions.sessions.values()) {
    if (session.principalId === options.keyId && session.revokedAt === null) {
      revokeFamily(options.sessions, session.familyId, now());
    }
  }
  return toKeyRow(row, now);
}

/**
 * Rotate a key secret — shown exactly once.
 *
 * @param store - API key store
 * @param keyId - Key id
 */
export async function accessRotateKey(
  store: ApiKeyStore,
  keyId: string,
): Promise<{ readonly row: AccessKeyRow; readonly secret: string } | null> {
  const rotated = await rotateApiKey(store, keyId);
  if (!rotated) return null;
  return {
    row: toKeyRow(rotated.row, () => Date.now()),
    secret: rotated.secret,
  };
}

/**
 * Create an operator invitation.
 *
 * @param store - Invite store
 * @param input - Invite fields
 */
export function accessCreateInvite(
  store: OperatorInviteStore,
  input: {
    readonly email: string;
    readonly invitedBy: string;
    readonly now?: () => number;
  },
) {
  return createOperatorInvite(store, input);
}

/** Access grant / plane error. */
export class AccessGrantError extends Error {
  /** @param message - Diagnostic */
  constructor(message: string) {
    super(message);
    this.name = "AccessGrantError";
  }
}

// ── internals ──────────────────────────────────────────────────────────────

/**
 * Expand held scopes for Access administration.
 *
 * `console:*` covers every `console:…` pair and, for the Access admin
 * surface, every application scope in the catalog so operators can manage
 * the user plane without holding application scopes on their own principal
 * (which Gates would flag as a plane violation).
 *
 * @param held - Actor scopes
 * @param catalog - Manifest Module:Action pairs
 */
export function expandAccessCeiling(
  held: Iterable<string>,
  catalog: readonly string[],
): Set<string> {
  const out = expandHeldScopes(held, catalog);
  let star = false;
  for (const s of held) {
    if (s === "console:*") star = true;
  }
  if (star) {
    for (const scope of catalog) {
      if (isApplicationScope(scope)) out.add(scope);
    }
  }
  return out;
}

function projectOperators(
  options: ProjectAccessOptions,
): AccessOperatorRow[] {
  const rows: AccessOperatorRow[] = [];
  for (const op of options.operators.operators.values()) {
    const roleIds = options.operators.roles.get(op.id) ?? [];
    const scopes = [
      ...scopesForRoles(options.roles, roleIds, "operator"),
    ].sort((a, b) => a.localeCompare(b));
    rows.push({
      id: op.id,
      email: op.email,
      name: op.name,
      status: op.status,
      roles: [...roleIds],
      scopes,
      lastSeenAt: op.lastSeenAt,
      neverSignedIn: op.lastSeenAt === null,
    });
  }
  return rows.sort((a, b) => a.email.localeCompare(b.email));
}

function projectUsers(options: ProjectAccessOptions): AccessUserRow[] {
  return options.identities
    .map((identity) => {
      const roleIds = roleIdsForMember(options.roleMembers, identity.id);
      const fromRoles = [
        ...scopesForRoles(options.roles, roleIds, "user"),
      ];
      const scopes = [
        ...new Set([...fromRoles, ...identity.scopes]),
      ].sort((a, b) => a.localeCompare(b));
      return {
        id: identity.id,
        email: identity.email,
        name: identity.name,
        status: identity.status,
        roles: roleIds,
        scopes,
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));
}

function projectRoles(options: ProjectAccessOptions): AccessRoleRow[] {
  const rows: AccessRoleRow[] = [];
  for (const role of options.roles.roles.values()) {
    rows.push({
      id: role.id,
      name: role.name,
      plane: role.plane,
      description: role.description,
      scopes: [...(options.roles.grants.get(role.id) ?? [])].sort((a, b) =>
        a.localeCompare(b),
      ),
      memberCount: options.roleMembers.get(role.id)?.length ?? 0,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function projectKeys(
  options: ProjectAccessOptions,
  now: () => number,
): AccessKeyRow[] {
  const rows: AccessKeyRow[] = [];
  for (const key of options.apiKeys.keys.values()) {
    rows.push(toKeyRow(key, now));
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function projectInvites(
  options: ProjectAccessOptions,
  now: () => number,
): AccessInviteRow[] {
  const rows: AccessInviteRow[] = [];
  for (const invite of options.invites.invites.values()) {
    rows.push({
      id: invite.id,
      email: invite.email,
      invitedBy: invite.invitedBy,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      expired: isInviteExpired(invite, now),
    });
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

function toKeyRow(
  key: {
    readonly id: string;
    readonly name: string;
    readonly plane: "user" | "operator";
    readonly scopes: readonly string[];
    readonly createdAt: number;
    readonly lastUsedAt: number | null;
    readonly expiresAt: number | null;
    readonly revokedAt: number | null;
    readonly rateLimit: { max: number; per: string } | null;
    readonly ipAllowlist: readonly string[];
  },
  now: () => number,
): AccessKeyRow {
  const unused90d = isKeyUnused90d(key, now);
  return {
    id: key.id,
    name: key.name,
    plane: key.plane,
    scopes: [...key.scopes].sort((a, b) => a.localeCompare(b)),
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt,
    rateLimit: key.rateLimit,
    ipAllowlist: [...key.ipAllowlist],
    unused90d,
  };
}

/**
 * Whether a key has been unused for 90+ days (or never used and aged 90d+).
 *
 * @param key - Key timestamps
 * @param now - Clock
 */
export function isKeyUnused90d(
  key: {
    readonly createdAt: number;
    readonly lastUsedAt: number | null;
    readonly revokedAt: number | null;
  },
  now: () => number = () => Date.now(),
): boolean {
  if (key.revokedAt !== null) return false;
  const t = now();
  if (key.lastUsedAt === null) {
    return t - key.createdAt >= KEY_UNUSED_MS;
  }
  return t - key.lastUsedAt >= KEY_UNUSED_MS;
}

function provenanceForRoles(
  roles: RoleStore,
  roleIds: readonly string[],
  plane: "user" | "operator",
): AccessScopeProvenance[] {
  const byScope = new Map<
    string,
    { kind: "role"; id: string; name: string }[]
  >();
  for (const roleId of roleIds) {
    const role = roles.roles.get(roleId);
    if (!role || role.plane !== plane) continue;
    for (const scope of roles.grants.get(roleId) ?? []) {
      const list = byScope.get(scope) ?? [];
      list.push({ kind: "role", id: role.id, name: role.name });
      byScope.set(scope, list);
    }
  }
  return [...byScope.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([scope, sources]) => ({ scope, sources }));
}

function roleIdsForMember(
  roleMembers: ReadonlyMap<string, readonly string[]>,
  memberId: string,
): string[] {
  const ids: string[] = [];
  for (const [roleId, members] of roleMembers) {
    if (members.includes(memberId)) ids.push(roleId);
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

function runTouchesKey(run: WideEvent, keyId: string): boolean {
  if (run.principal === keyId) return true;
  const dims = run.dimensions;
  if (dims.principal === keyId) return true;
  if (dims.api_key === keyId || dims.apiKey === keyId || dims.key === keyId) {
    return true;
  }
  return false;
}

function sourceAddressOf(run: WideEvent): string | null {
  const dims = run.dimensions;
  for (const key of ["ip", "source_ip", "sourceIp", "remote_addr", "client_ip"]) {
    const v = dims[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function collectCatalogFromStores(
  roles: RoleStore,
  apiKeys: ApiKeyStore,
): string[] {
  const set = new Set<string>();
  for (const grants of roles.grants.values()) {
    for (const g of grants) set.add(g);
  }
  for (const key of apiKeys.keys.values()) {
    for (const s of key.scopes) set.add(s);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
