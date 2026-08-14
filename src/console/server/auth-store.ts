/**
 * Console operator-plane auth schema — projected into Store browse.
 *
 * App tables stay on Manifest `sql:db` (`public`). Auth tables live in
 * Postgres schema `oke_console` and are never joined across the plane.
 * Browse reads the in-memory operator / session / role maps (hydrated from
 * that schema). Mutations are refused.
 */

import { AUTH_TABLES } from "../../auth/tables.ts";
import { PII_MASK } from "../../elements/store/classify.ts";
import type { ResourceRef } from "../../manifest/types.ts";
import type {
  ApiKeyStore,
  OperatorInviteStore,
  OperatorStore,
  RoleStore,
  SessionStore,
} from "../../auth/index.ts";
import type {
  ConsoleStoreChild,
  ConsoleStoreRow,
  StoreQueryInput,
  StoreQueryResult,
} from "./store.ts";
import { fallbackExtensions, sqlCatalogKind, sqlCatalogStoreChildren } from "./sql-catalog.ts";

/** Manifest-style store name for the Console auth schema. */
export const CONSOLE_AUTH_STORE_NAME = "oke_console";

/** Effect / list ref (`sql:oke_console`). */
export const CONSOLE_AUTH_STORE_REF = `sql:${CONSOLE_AUTH_STORE_NAME}` as ResourceRef;

/** Opt-in env that surfaces `sql:oke_console` in Store browse. */
export const CONSOLE_AUTH_STORE_ENV = "OKE_CONSOLE_AUTH_STORE";

/**
 * True when Store browse should list / query `oke_console`.
 * Off by default; set `OKE_CONSOLE_AUTH_STORE=1` (or `true`) to enable.
 *
 * @param env - Process env (injectable in tests)
 */
export function consoleAuthStoreEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const raw = env[CONSOLE_AUTH_STORE_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Refuse browse / query of `oke_console` unless {@link consoleAuthStoreEnabled}.
 *
 * @param env - Process env (injectable in tests)
 */
export function requireConsoleAuthStore(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (consoleAuthStoreEnabled(env)) return;
  throw new Error("oke_console is hidden unless OKE_CONSOLE_AUTH_STORE=1");
}

/** User-plane identity row used by invoke-as (subset of `oke_identities`). */
export interface ConsoleAuthIdentity {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: string;
  readonly scopes: readonly string[];
}

/** In-memory sources that back {@link queryConsoleAuthStore}. */
export interface ConsoleAuthStoreSource {
  readonly operators: OperatorStore;
  readonly sessions: SessionStore;
  readonly roles: RoleStore;
  readonly apiKeys: ApiKeyStore;
  readonly invites: OperatorInviteStore;
  readonly identities: readonly ConsoleAuthIdentity[];
  readonly roleMembers: ReadonlyMap<string, readonly string[]>;
}

/** One auth table: physical name, PII columns, column help. */
interface AuthTableSpec {
  readonly name: string;
  readonly description: string;
  readonly piiColumns: readonly string[];
  readonly columns: Readonly<Record<string, string>>;
}

const AUTH_TABLE_SPECS: readonly AuthTableSpec[] = [
  {
    name: AUTH_TABLES.operators,
    description: "Console operators (operator plane)",
    piiColumns: ["email"],
    columns: {
      id: "Operator id",
      email: "Sign-in email (PII)",
      name: "Display name",
      status: "active · suspended · invited",
      mfa_enabled: "MFA enrolled",
      invited_by: "Inviting operator id",
      last_seen_at: "Last activity (epoch ms)",
    },
  },
  {
    name: AUTH_TABLES.operatorCredentials,
    description: "Local password hashes — never removable",
    piiColumns: ["password_hash"],
    columns: {
      operator_id: "Operator id",
      password_hash: "Argon2id hash (sensitive)",
      login_enabled: "Local login still allowed",
    },
  },
  {
    name: AUTH_TABLES.operatorSsoLinks,
    description: "Additive SSO links (local credential remains)",
    piiColumns: ["subject"],
    columns: {
      operator_id: "Operator id",
      provider: "SSO provider id",
      subject: "Provider subject (PII)",
    },
  },
  {
    name: AUTH_TABLES.operatorRoles,
    description: "Operator ↔ role assignments",
    piiColumns: [],
    columns: {
      operator_id: "Operator id",
      role: "Role id",
    },
  },
  {
    name: AUTH_TABLES.operatorInvites,
    description: "Pending operator invitations",
    piiColumns: ["email"],
    columns: {
      id: "Invite id",
      email: "Invitee email (PII)",
      invited_by: "Inviting operator id",
      created_at: "Created (epoch ms)",
      expires_at: "Expires (epoch ms)",
      accepted_at: "Accepted (epoch ms)",
    },
  },
  {
    name: AUTH_TABLES.identities,
    description: "User-plane identities (invoke-as / Gate auth)",
    piiColumns: ["email"],
    columns: {
      id: "Identity id",
      email: "Email (PII)",
      name: "Display name",
      status: "active · disabled",
      scopes: "Granted scopes",
    },
  },
  {
    name: AUTH_TABLES.credentials,
    description: "User-plane credentials (Gate auth account model)",
    piiColumns: ["password_hash"],
    columns: {
      id: "Credential id",
      user_id: "Identity id",
      provider: "Provider id",
      provider_account_id: "Provider subject",
      password_hash: "Password hash (sensitive)",
    },
  },
  {
    name: AUTH_TABLES.identityRoles,
    description: "User-plane identity ↔ role",
    piiColumns: [],
    columns: {
      identity_id: "Identity id",
      role_id: "Role id",
    },
  },
  {
    name: AUTH_TABLES.roles,
    description: "Roles (data, not code) — both planes",
    piiColumns: [],
    columns: {
      id: "Role id",
      name: "Role name",
      plane: "user · operator",
      description: "Grant description",
    },
  },
  {
    name: AUTH_TABLES.roleGrants,
    description: "Role → Module:Action grants",
    piiColumns: [],
    columns: {
      role_id: "Role id",
      action: "Module:Action scope",
    },
  },
  {
    name: AUTH_TABLES.apiKeys,
    description: "API keys (first-class principals)",
    piiColumns: ["hash"],
    columns: {
      id: "Key id",
      plane: "user · operator",
      hash: "Secret hash (sensitive)",
      name: "Key name",
      scopes: "Attenuated scopes",
      expires_at: "Expiry (epoch ms)",
      created_at: "Created (epoch ms)",
      last_used_at: "Last use (epoch ms)",
      revoked_at: "Revoked (epoch ms)",
    },
  },
  {
    name: AUTH_TABLES.sessions,
    description: "Hybrid sessions (short JWT + revocable refresh)",
    piiColumns: [],
    columns: {
      id: "Session id",
      plane: "user · operator",
      principal_id: "Operator or identity id",
      family_id: "Refresh family",
      revoked_at: "Revoked (epoch ms)",
      created_at: "Issued (epoch ms)",
      expires_at: "Access expiry (epoch ms)",
      last_active_at: "Last activity (epoch ms)",
      scopes: "Access-token scopes",
      audience: "oke-console · oke-mcp · oke-app",
    },
  },
  {
    name: AUTH_TABLES.refreshTokens,
    description: "Hashed refresh tokens (rotation + reuse detection)",
    piiColumns: ["hash"],
    columns: {
      id: "Token id",
      session_id: "Session id",
      family_id: "Refresh family",
      hash: "Token hash (sensitive)",
      expires_at: "Expiry (epoch ms)",
      used_at: "Used (epoch ms)",
      revoked_at: "Revoked (epoch ms)",
    },
  },
  {
    name: AUTH_TABLES.verifications,
    description: "OTP / magic-link challenges",
    piiColumns: ["identifier", "value"],
    columns: {
      id: "Challenge id",
      identifier: "Email or subject (PII)",
      value: "Sealed challenge (sensitive)",
      expires_at: "Expiry (epoch ms)",
      created_at: "Created (epoch ms)",
    },
  },
];

/**
 * True when `ref` is the Console auth store (`sql:oke_console`).
 *
 * @param ref - Store resource ref
 */
export function isConsoleAuthStoreRef(ref: string): boolean {
  return ref === CONSOLE_AUTH_STORE_REF;
}

/**
 * Project the `oke_console` store row for `console.store.list`.
 */
export function projectConsoleAuthStore(): ConsoleStoreRow {
  const children: ConsoleStoreChild[] = AUTH_TABLE_SPECS.map((spec) => {
    const effectRef = `${CONSOLE_AUTH_STORE_REF}/${spec.name}` as ResourceRef;
    return {
      name: spec.name,
      effectRef,
      writers: [],
      readers: [],
      cache: {
        producedByRead: `computed:${effectRef}`,
        invalidatedByWrites: [],
        invalidatingFlowIds: [],
      },
      willNotFire: { writerFlowIds: [], signals: [], channels: [] },
      piiColumns: [...spec.piiColumns],
      columnDescriptions: { ...spec.columns },
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const withCatalog = [...children, ...sqlCatalogStoreChildren(CONSOLE_AUTH_STORE_REF)];

  return {
    ref: CONSOLE_AUTH_STORE_REF,
    facet: "sql",
    name: CONSOLE_AUTH_STORE_NAME,
    description: "Console auth schema — operator plane, never joined to public",
    children: withCatalog,
    replicaLagMs: null,
    migrationDrift: null,
    contentAddressed: false,
    warnings: [
      {
        code: "operator-plane",
        message:
          "Read-only Console auth schema (Postgres `oke_console`). Planes are never joined to app tables.",
        key: CONSOLE_AUTH_STORE_NAME,
      },
    ],
  };
}

/**
 * Browse one auth table from in-memory Console stores.
 *
 * @param source - Operator / session / role maps
 * @param input - Store query (child = physical table name)
 */
export function queryConsoleAuthStore(
  source: ConsoleAuthStoreSource,
  input: StoreQueryInput,
): StoreQueryResult {
  const table = input.child;
  const catalog = table ? sqlCatalogKind(table) : null;
  if (catalog) {
    const rows =
      catalog === "index"
        ? AUTH_TABLE_SPECS.map((spec) => ({
            name: `${spec.name}_pkey`,
            table: spec.name,
            columns: "id" in spec.columns ? "id" : (Object.keys(spec.columns)[0] ?? ""),
            unique: true,
            def: `PRIMARY KEY (${"id" in spec.columns ? "id" : (Object.keys(spec.columns)[0] ?? "")})`,
          }))
        : catalog === "extension"
          ? fallbackExtensions()
          : [];
    return { facet: "sql", rows, masked: false };
  }
  const spec = AUTH_TABLE_SPECS.find((s) => s.name === table);
  if (!table || !spec) {
    return { facet: "sql", rows: [], masked: !input.revealPii };
  }
  const limit = input.limit ?? 50;
  const raw = rowsForTable(source, table);
  const reveal = input.revealPii === true;
  const rows = raw.slice(0, limit).map((row) => maskRow(row, spec.piiColumns, reveal));
  return { facet: "sql", rows, masked: !reveal };
}

/**
 * Refuse Store edit / delete / raw SQL against the auth schema.
 *
 * @param ref - Store resource ref
 */
export function rejectConsoleAuthMutation(ref: string): void {
  if (!isConsoleAuthStoreRef(ref)) return;
  throw new Error("oke_console is the operator-plane auth schema — read-only from Store browse");
}

function rowsForTable(source: ConsoleAuthStoreSource, table: string): Record<string, unknown>[] {
  switch (table) {
    case AUTH_TABLES.operators:
      return [...source.operators.operators.values()].map((op) => ({
        id: op.id,
        email: op.email,
        name: op.name,
        status: op.status,
        mfa_enabled: op.mfaEnabled,
        invited_by: op.invitedBy,
        last_seen_at: op.lastSeenAt,
      }));
    case AUTH_TABLES.operatorCredentials:
      return [...source.operators.credentials.values()].map((c) => ({
        operator_id: c.operatorId,
        password_hash: c.passwordHash,
        login_enabled: c.loginEnabled,
      }));
    case AUTH_TABLES.operatorSsoLinks: {
      const rows: Record<string, unknown>[] = [];
      for (const [operatorId, links] of source.operators.ssoLinks) {
        for (const link of links) {
          rows.push({
            operator_id: operatorId,
            provider: link.provider,
            subject: link.subject,
          });
        }
      }
      return rows;
    }
    case AUTH_TABLES.operatorRoles: {
      const rows: Record<string, unknown>[] = [];
      for (const [operatorId, roles] of source.operators.roles) {
        for (const role of roles) {
          rows.push({ operator_id: operatorId, role });
        }
      }
      return rows;
    }
    case AUTH_TABLES.operatorInvites:
      return [...source.invites.invites.values()].map((inv) => ({
        id: inv.id,
        email: inv.email,
        invited_by: inv.invitedBy,
        created_at: inv.createdAt,
        expires_at: inv.expiresAt,
        accepted_at: inv.acceptedAt,
      }));
    case AUTH_TABLES.identities:
      return source.identities.map((id) => ({
        id: id.id,
        email: id.email,
        name: id.name,
        status: id.status,
        scopes: [...id.scopes],
      }));
    case AUTH_TABLES.credentials:
      return [];
    case AUTH_TABLES.identityRoles: {
      const rows: Record<string, unknown>[] = [];
      for (const [roleId, members] of source.roleMembers) {
        for (const identityId of members) {
          rows.push({ identity_id: identityId, role_id: roleId });
        }
      }
      return rows;
    }
    case AUTH_TABLES.roles:
      return [...source.roles.roles.values()].map((r) => ({
        id: r.id,
        name: r.name,
        plane: r.plane,
        description: r.description,
      }));
    case AUTH_TABLES.roleGrants: {
      const rows: Record<string, unknown>[] = [];
      for (const [roleId, actions] of source.roles.grants) {
        for (const action of actions) {
          rows.push({ role_id: roleId, action });
        }
      }
      return rows;
    }
    case AUTH_TABLES.apiKeys:
      return [...source.apiKeys.keys.values()].map((k) => ({
        id: k.id,
        plane: k.plane,
        hash: k.hash,
        name: k.name,
        scopes: [...k.scopes],
        expires_at: k.expiresAt,
        created_at: k.createdAt,
        last_used_at: k.lastUsedAt,
        revoked_at: k.revokedAt,
      }));
    case AUTH_TABLES.sessions:
      return [...source.sessions.sessions.values()].map((s) => ({
        id: s.id,
        plane: s.plane,
        principal_id: s.principalId,
        family_id: s.familyId,
        revoked_at: s.revokedAt,
        created_at: s.createdAt,
        expires_at: s.expiresAt,
        last_active_at: s.lastActiveAt,
        scopes: [...s.scopes],
        audience: s.audience ?? null,
      }));
    case AUTH_TABLES.refreshTokens:
      return [...source.sessions.refresh.values()].map((t) => ({
        id: t.id,
        session_id: t.sessionId,
        family_id: t.familyId,
        hash: t.hash,
        expires_at: t.expiresAt,
        used_at: t.usedAt,
        revoked_at: t.revokedAt,
      }));
    case AUTH_TABLES.verifications:
      return [];
    default:
      return [];
  }
}

function maskRow(
  row: Record<string, unknown>,
  piiColumns: readonly string[],
  reveal: boolean,
): Record<string, unknown> {
  if (reveal || piiColumns.length === 0) return row;
  const out: Record<string, unknown> = { ...row };
  for (const col of piiColumns) {
    if (out[col] !== null && out[col] !== undefined) out[col] = PII_MASK;
  }
  return out;
}
