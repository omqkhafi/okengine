/**
 * Access panel view types (console §9.14).
 */

/** Operator row. */
export interface AccessOperatorRecord {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: "active" | "suspended" | "invited";
  readonly roles: readonly string[];
  readonly scopes: readonly string[];
  readonly lastSeenAt: number | null;
  readonly neverSignedIn: boolean;
}

/** User-plane identity. */
export interface AccessUserRecord {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: "active" | "disabled";
  readonly roles: readonly string[];
  readonly scopes: readonly string[];
}

/** Role with grants. */
export interface AccessRoleRecord {
  readonly id: string;
  readonly name: string;
  readonly plane: "user" | "operator";
  readonly description: string;
  readonly scopes: readonly string[];
  readonly memberCount: number;
}

/** API key (no secret). */
export interface AccessKeyRecord {
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

/** Invitation. */
export interface AccessInviteRecord {
  readonly id: string;
  readonly email: string;
  readonly invitedBy: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly expired: boolean;
}

/** One plane section — never merged with the other. */
export interface AccessPlaneRecord {
  readonly plane: "user" | "operator";
  readonly operators?: readonly AccessOperatorRecord[];
  readonly users?: readonly AccessUserRecord[];
  readonly roles: readonly AccessRoleRecord[];
  readonly keys: readonly AccessKeyRecord[];
  readonly invites?: readonly AccessInviteRecord[];
  readonly grantableScopes: readonly string[];
}

/** Hygiene findings. */
export interface AccessHygieneRecord {
  readonly unusedKeys: readonly AccessKeyRecord[];
  readonly neverSignedInOperators: readonly AccessOperatorRecord[];
  readonly expiredInvitations: readonly AccessInviteRecord[];
}

/** `console.access.list` response. */
export interface AccessListResponse {
  readonly operatorPlane: AccessPlaneRecord;
  readonly userPlane: AccessPlaneRecord;
  readonly hygiene: AccessHygieneRecord;
  readonly accessTtlMs: number;
  readonly catalog: readonly string[];
}

/** Effective permissions with provenance. */
export interface AccessEffectiveResponse {
  readonly kind: "operator" | "user" | "role" | "key";
  readonly id: string;
  readonly plane: "user" | "operator";
  readonly scopes: readonly {
    readonly scope: string;
    readonly sources: readonly {
      readonly kind: "role" | "direct";
      readonly id: string;
      readonly name: string;
    }[];
  }[];
}

/** Key blast radius from Runs. */
export interface AccessBlastRadius {
  readonly callVolume: number;
  readonly lastUsedAt: number | null;
  readonly sourceAddresses: readonly string[];
  readonly accessTtlMs: number;
  readonly residualAccessNote: string;
}
