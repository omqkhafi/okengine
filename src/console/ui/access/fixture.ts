/**
 * Fixture Access projection for unit tests and the axe gate.
 */

import type {
  AccessBlastRadius,
  AccessEffectiveResponse,
  AccessListResponse,
} from "./types.ts";

/** Full list response fixture — planes separate. */
export const ACCESS_LIST_FIXTURE: AccessListResponse = {
  accessTtlMs: 14 * 60 * 1000,
  catalog: [
    "booking:create",
    "console:flows:invoke-as",
    "console:store.sql:read",
    "console:store.sql:write",
    "member",
  ],
  operatorPlane: {
    plane: "operator",
    operators: [
      {
        id: "op1",
        email: "ops@example.com",
        name: "Ops",
        status: "active",
        roles: ["role_ops"],
        scopes: ["console:store.sql:read", "console:store.sql:write"],
        lastSeenAt: 1_700_000_000_000,
        neverSignedIn: false,
      },
      {
        id: "op_never",
        email: "never@example.com",
        name: "Never Signed In",
        status: "invited",
        roles: ["role_ops"],
        scopes: ["console:store.sql:read"],
        lastSeenAt: null,
        neverSignedIn: true,
      },
    ],
    roles: [
      {
        id: "role_ops",
        name: "ops",
        plane: "operator",
        description: "Console operators",
        scopes: ["console:store.sql:read", "console:store.sql:write"],
        memberCount: 2,
      },
    ],
    keys: [
      {
        id: "key_ops",
        name: "Ops automation",
        plane: "operator",
        scopes: ["console:store.sql:read"],
        createdAt: 1_700_000_000_000,
        lastUsedAt: 1_700_000_100_000,
        expiresAt: null,
        revokedAt: null,
        rateLimit: null,
        ipAllowlist: [],
        unused90d: false,
      },
    ],
    invites: [
      {
        id: "invite_expired",
        email: "expired@example.com",
        invitedBy: "seed",
        createdAt: 1_699_000_000_000,
        expiresAt: 1_699_500_000_000,
        expired: true,
      },
    ],
    grantableScopes: [
      "console:flows:invoke-as",
      "console:store.sql:read",
      "console:store.sql:write",
    ],
  },
  userPlane: {
    plane: "user",
    users: [
      {
        id: "user_demo",
        email: "demo@example.com",
        name: "Demo User",
        status: "active",
        roles: ["role_member"],
        scopes: ["booking:create", "member"],
      },
    ],
    roles: [
      {
        id: "role_member",
        name: "member",
        plane: "user",
        description: "Verified members",
        scopes: ["booking:create", "member"],
        memberCount: 1,
      },
    ],
    keys: [
      {
        id: "key_demo",
        name: "Demo key",
        plane: "user",
        scopes: ["booking:create", "member"],
        createdAt: 1_700_000_000_000,
        lastUsedAt: 1_700_000_050_000,
        expiresAt: null,
        revokedAt: null,
        rateLimit: null,
        ipAllowlist: ["203.0.113.10"],
        unused90d: false,
      },
      {
        id: "key_stale",
        name: "Stale unused key",
        plane: "user",
        scopes: ["member"],
        createdAt: 1_690_000_000_000,
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        rateLimit: null,
        ipAllowlist: [],
        unused90d: true,
      },
    ],
    grantableScopes: ["booking:create", "member"],
  },
  hygiene: {
    unusedKeys: [
      {
        id: "key_stale",
        name: "Stale unused key",
        plane: "user",
        scopes: ["member"],
        createdAt: 1_690_000_000_000,
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        rateLimit: null,
        ipAllowlist: [],
        unused90d: true,
      },
    ],
    neverSignedInOperators: [
      {
        id: "op_never",
        email: "never@example.com",
        name: "Never Signed In",
        status: "invited",
        roles: ["role_ops"],
        scopes: ["console:store.sql:read"],
        lastSeenAt: null,
        neverSignedIn: true,
      },
    ],
    expiredInvitations: [
      {
        id: "invite_expired",
        email: "expired@example.com",
        invitedBy: "seed",
        createdAt: 1_699_000_000_000,
        expiresAt: 1_699_500_000_000,
        expired: true,
      },
    ],
  },
};

/** Effective permissions fixture — provenance. */
export const ACCESS_EFFECTIVE_FIXTURE: AccessEffectiveResponse = {
  kind: "user",
  id: "user_demo",
  plane: "user",
  scopes: [
    {
      scope: "booking:create",
      sources: [{ kind: "role", id: "role_member", name: "member" }],
    },
    {
      scope: "member",
      sources: [{ kind: "role", id: "role_member", name: "member" }],
    },
  ],
};

/** Blast radius fixture from Runs. */
export const ACCESS_BLAST_FIXTURE: AccessBlastRadius = {
  callVolume: 42,
  lastUsedAt: 1_700_000_050_000,
  sourceAddresses: ["203.0.113.10", "198.51.100.7"],
  accessTtlMs: 14 * 60 * 1000,
  residualAccessNote: "Existing access may continue up to 14 minutes",
};
