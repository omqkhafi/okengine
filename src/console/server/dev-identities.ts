/**
 * Default invoke-as identities — ten rungs from owner to guest.
 *
 * `user_demo` (owner) and `user_member` keep their historic ids so Call API
 * tests and Access fixtures stay stable. Owner scopes follow the Manifest;
 * lower rungs intersect a named profile with that catalog. Keel (`app ===
 * "keel"`) always unions {@link KEEL_SCOPES} so seeding is not missing a
 * declared Gate. No leftover app catalog is invented for other apps.
 */

import { setRoleGrants, upsertRole, type RoleStore } from "../../auth/index.ts";
import type { Manifest } from "../../manifest/types.ts";

/**
 * Every Keel user-plane scope — `gate.policy("member")` plus `gate.scope`.
 * Seeded onto the owner → guest ladder when the Manifest app is `keel`.
 */
export const KEEL_SCOPES = [
  "member",
  "task:write",
  "comment:write",
  "files:write",
  "project:admin",
  "member:admin",
  "webhook:admin",
] as const;

/** One seeded development identity. */
export interface SeededDevIdentity {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: "active";
  readonly scopes: readonly string[];
}

/** Stable person for one authorization rung. */
export interface DevIdentityPerson {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  /** Workspace / Access role label, owner → guest. */
  readonly role: string;
}

/**
 * Ten people, owner → guest. Demo and Member keep historic ids.
 */
export const DEV_IDENTITY_LADDER = [
  { id: "user_demo", email: "demo@example.com", name: "Demo User", role: "owner" },
  { id: "user_admin", email: "admin@example.com", name: "Admin", role: "admin" },
  {
    id: "user_workspace",
    email: "workspace@example.com",
    name: "Workspace Admin",
    role: "workspace_admin",
  },
  { id: "user_pm", email: "pm@example.com", name: "Project Manager", role: "project_manager" },
  { id: "user_lead", email: "lead@example.com", name: "Lead", role: "lead" },
  { id: "user_dev", email: "developer@example.com", name: "Developer", role: "developer" },
  { id: "user_writer", email: "writer@example.com", name: "Contributor", role: "contributor" },
  { id: "user_member", email: "member@example.com", name: "Member", role: "member" },
  { id: "user_commenter", email: "commenter@example.com", name: "Commenter", role: "commenter" },
  { id: "user_guest", email: "guest@example.com", name: "Guest", role: "guest" },
] as const satisfies readonly DevIdentityPerson[];

/** One Keel ladder role and the scopes it holds. */
export type KeelLadderRole = (typeof DEV_IDENTITY_LADDER)[number]["role"];

/**
 * Owner → guest grants. Owner and admin hold {@link KEEL_SCOPES}.
 */
export const KEEL_LADDER_GRANTS: Readonly<Record<KeelLadderRole, readonly string[]>> = {
  owner: KEEL_SCOPES,
  admin: KEEL_SCOPES,
  workspace_admin: [
    "member",
    "task:write",
    "comment:write",
    "files:write",
    "project:admin",
    "member:admin",
  ],
  project_manager: ["member", "task:write", "comment:write", "files:write", "project:admin"],
  lead: ["member", "task:write", "comment:write", "project:admin"],
  developer: ["member", "task:write", "comment:write", "files:write"],
  contributor: ["member", "task:write", "comment:write"],
  member: ["member"],
  commenter: ["member", "comment:write"],
  guest: [],
};

/** `*` = every catalog scope (owner). Other rungs follow {@link KEEL_LADDER_GRANTS}. */
const LADDER_SCOPE_PROFILES: readonly (readonly string[] | "*")[] = [
  "*",
  ...DEV_IDENTITY_LADDER.slice(1).map((person) => KEEL_LADDER_GRANTS[person.role]),
];

/**
 * Whether this Manifest is the Keel example (full scope seed applies).
 *
 * @param manifest - Optional Manifest
 */
export function isKeelManifest(manifest?: Manifest | null): boolean {
  return manifest?.app === "keel";
}

/**
 * Application scopes implied by a Manifest — gate `scopes`, scoped gate
 * ids, and flow gate refs. Always includes `member`.
 *
 * @param manifest - Optional Manifest
 */
export function demoScopesFromManifest(manifest?: Manifest | null): string[] {
  const scopes = new Set<string>(["member"]);
  if (isKeelManifest(manifest)) {
    for (const scope of KEEL_SCOPES) scopes.add(scope);
  }
  if (!manifest) return [...scopes].sort();
  for (const [gateId, gate] of Object.entries(manifest.gates ?? {})) {
    for (const scope of gate.scopes ?? []) scopes.add(scope);
    if (gateId.includes(":") && !gateId.startsWith("rate:")) scopes.add(gateId);
  }
  for (const flow of Object.values(manifest.flows ?? {})) {
    for (const gate of flow.gates ?? []) {
      if (gate.includes(":") && !gate.startsWith("rate:")) scopes.add(gate);
    }
  }
  return [...scopes].sort();
}

/**
 * Scopes for one ladder rung — owner is the full catalog; others intersect
 * their profile. `member` stays on every signed-in rung.
 *
 * @param rung - 0 (owner) … 9 (guest)
 * @param catalog - Manifest-derived scopes
 */
export function scopesForDevIdentityRung(rung: number, catalog: readonly string[]): string[] {
  const profile = LADDER_SCOPE_PROFILES[rung];
  if (profile === undefined) return [];
  if (profile === "*") return [...catalog].sort((a, b) => a.localeCompare(b));
  const allowed = new Set(catalog);
  return [...new Set(profile.filter((scope) => scope === "member" || allowed.has(scope)))].sort(
    (a, b) => a.localeCompare(b),
  );
}

/**
 * Default development identities for the invoke-as picker.
 *
 * @param manifest - Optional Manifest used to derive application scopes
 */
export function defaultDevIdentities(manifest?: Manifest | null): SeededDevIdentity[] {
  const catalog = demoScopesFromManifest(manifest);
  return DEV_IDENTITY_LADDER.map((person, rung) => ({
    id: person.id,
    email: person.email,
    name: person.name,
    status: "active",
    scopes: scopesForDevIdentityRung(rung, catalog),
  }));
}

/**
 * Whether the live list is still the built-in ladder (safe to refresh).
 *
 * @param identities - Live identity list
 */
export function isDefaultIdentitySeed(identities: readonly { readonly id: string }[]): boolean {
  if (identities.length !== DEV_IDENTITY_LADDER.length) return false;
  const ids = new Set(identities.map((row) => row.id));
  return DEV_IDENTITY_LADDER.every((person) => ids.has(person.id));
}

/**
 * Signed-in ladder ids (guest excluded) — default `role_member` holders.
 */
export function defaultMemberIdentityIds(): string[] {
  return DEV_IDENTITY_LADDER.filter((person) => person.role !== "guest").map((person) => person.id);
}

/**
 * Replace the default ladder when a Manifest arrives.
 *
 * @param identities - Live identity list
 * @param manifest - New Manifest
 */
export function refreshSeededIdentities(
  identities: Array<{
    id: string;
    email: string;
    name: string;
    status: "active" | "disabled";
    scopes: readonly string[];
  }>,
  manifest: Manifest | null,
): void {
  if (!isDefaultIdentitySeed(identities)) return;
  const next = defaultDevIdentities(manifest);
  identities.splice(0, identities.length, ...next);
}

/**
 * Seed Access roles for Keel — every {@link KEEL_SCOPES} pair lands on the
 * owner / admin rung; lower rungs use {@link KEEL_LADDER_GRANTS}.
 *
 * @param roles - Role store
 * @param roleMembers - roleId → principal ids
 */
export function seedKeelAccessRoles(roles: RoleStore, roleMembers: Map<string, string[]>): void {
  for (const person of DEV_IDENTITY_LADDER) {
    const roleId = `role_${person.role}`;
    upsertRole(roles, {
      id: roleId,
      name: person.role,
      plane: "user",
      description:
        person.role === "owner"
          ? "Full workspace authorization"
          : person.role === "guest"
            ? "Least authorization — no write scopes"
            : `Keel ${person.role.replaceAll("_", " ")}`,
    });
    setRoleGrants(roles, roleId, KEEL_LADDER_GRANTS[person.role]);
    roleMembers.set(roleId, person.role === "guest" ? [] : [person.id]);
  }
  roleMembers.set("role_member", defaultMemberIdentityIds());
}
