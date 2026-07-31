/**
 * Auth Store tables — `oke_` prefix, planes never joined.
 *
 * @see docs/spec/console.md §8
 */

/** Auth / Console table names. */
export const AUTH_TABLES = {
  // Operator plane — never joined to the user plane
  operators: "oke_operators",
  operatorCredentials: "oke_operator_credentials",
  operatorSsoLinks: "oke_operator_sso_links",
  operatorRoles: "oke_operator_roles",
  operatorInvites: "oke_operator_invites",
  // User plane
  identities: "oke_identities",
  credentials: "oke_credentials",
  identityRoles: "oke_identity_roles",
  // Shared grammar, separate grants
  roles: "oke_roles",
  roleGrants: "oke_role_grants",
  apiKeys: "oke_api_keys",
  // Session tables (auth element owns these)
  sessions: "oke_sessions",
  refreshTokens: "oke_refresh_tokens",
} as const;

/** Plane column values stored on shared tables. */
export type TablePlane = "user" | "operator";

/** Row shapes (in-memory / descriptor — not ORM-bound). */
export interface OperatorRow {
  id: string;
  email: string;
  name: string;
  status: "active" | "suspended" | "invited";
  mfaEnabled: boolean;
  invitedBy: string | null;
  lastSeenAt: number | null;
}

/** Local password hash — always present for operators, never removable. */
export interface OperatorCredentialRow {
  operatorId: string;
  passwordHash: string;
  /** Local login may be disabled after SSO-primary, but the row remains. */
  loginEnabled: boolean;
}

/** Optional linked SSO identity (additional method only). */
export interface OperatorSsoLinkRow {
  operatorId: string;
  provider: string;
  subject: string;
}

/** User-plane identity. */
export interface IdentityRow {
  id: string;
  provider: string;
  subject: string;
  email: string;
  name: string;
  status: "active" | "suspended";
  lastSeenAt: number | null;
}

/** Role (data, not code). */
export interface RoleRow {
  id: string;
  name: string;
  plane: TablePlane;
  description: string;
}

/** Role → Module:Action grant. */
export interface RoleGrantRow {
  roleId: string;
  action: string;
}

/** API key principal. */
export interface ApiKeyRow {
  id: string;
  plane: TablePlane;
  hash: string;
  name: string;
  scopes: string[];
  expiresAt: number | null;
  rateLimit: { max: number; per: string } | null;
  ipAllowlist: string[];
  creatorId: string;
  creatorScopes: string[];
  /** Epoch-ms when the key was created (hygiene: unused 90d+). */
  createdAt: number;
  lastUsedAt: number | null;
  /** Epoch-ms when revoked; `null` while active. */
  revokedAt: number | null;
}

/** Pending operator invitation (invite-only plane). */
export interface OperatorInviteRow {
  id: string;
  email: string;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
}

/** Hybrid session (short JWT + revocable refresh). */
export interface SessionRow {
  id: string;
  plane: TablePlane;
  principalId: string;
  familyId: string;
  revokedAt: number | null;
  createdAt: number;
  expiresAt: number;
  /** Last activity epoch-ms (idle timeout). Updated on refresh / access touch. */
  lastActiveAt: number;
}

/** Refresh token (hashed at rest); rotation with reuse detection. */
export interface RefreshTokenRow {
  id: string;
  sessionId: string;
  familyId: string;
  hash: string;
  expiresAt: number;
  usedAt: number | null;
  revokedAt: number | null;
}
