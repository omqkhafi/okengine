/**
 * Core Gate auth schema — defaults + `modelName` / `fields` / `additionalFields`.
 *
 * Used by `gate.auth` resolution and `oke schema generate`.
 */

import { AUTH_TABLES } from "./tables.ts";

/** Supported additional-field value types. */
export type AuthFieldType = "string" | "number" | "boolean" | "json";

/** Extra column declared on a core auth model. */
export interface AuthAdditionalField {
  readonly type: AuthFieldType;
  readonly required?: boolean;
  readonly defaultValue?: unknown;
  /** Database column name when different from the field key. */
  readonly fieldName?: string;
}

/** Per-model customization. */
export interface AuthModelOptions {
  /** Physical table name. */
  readonly modelName?: string;
  /**
   * Rename logical fields → physical columns
   * (e.g. `{ principalId: "user_id" }`).
   */
  readonly fields?: Readonly<Record<string, string>>;
  /** Extra columns beyond the core set. */
  readonly additionalFields?: Readonly<Record<string, AuthAdditionalField>>;
}

/** Logical core models Gate auth owns. */
export type AuthCoreModel =
  | "user"
  | "account"
  | "session"
  | "refreshToken"
  | "verification"
  | "roles"
  | "apiKeys";

/** Default logical → physical field map per model. */
export const AUTH_MODEL_DEFAULT_FIELDS: Readonly<
  Record<AuthCoreModel, Readonly<Record<string, string>>>
> = {
  user: {
    id: "id",
    email: "email",
    name: "name",
    emailVerified: "email_verified",
    image: "image",
    createdAt: "created_at",
    updatedAt: "updated_at",
    status: "status",
  },
  account: {
    id: "id",
    userId: "user_id",
    provider: "provider",
    providerAccountId: "provider_account_id",
    passwordHash: "password_hash",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  session: {
    id: "id",
    principalId: "principal_id",
    plane: "plane",
    familyId: "family_id",
    revokedAt: "revoked_at",
    createdAt: "created_at",
    expiresAt: "expires_at",
    lastActiveAt: "last_active_at",
    scopes: "scopes",
    audience: "audience",
  },
  refreshToken: {
    id: "id",
    sessionId: "session_id",
    familyId: "family_id",
    hash: "hash",
    expiresAt: "expires_at",
    usedAt: "used_at",
    revokedAt: "revoked_at",
  },
  verification: {
    id: "id",
    identifier: "identifier",
    value: "value",
    expiresAt: "expires_at",
    createdAt: "created_at",
  },
  roles: {
    id: "id",
    name: "name",
    plane: "plane",
    description: "description",
  },
  apiKeys: {
    id: "id",
    plane: "plane",
    hash: "hash",
    name: "name",
    scopes: "scopes",
    expiresAt: "expires_at",
    createdAt: "created_at",
    lastUsedAt: "last_used_at",
    revokedAt: "revoked_at",
  },
};

/** Default table names (aligned with {@link AUTH_TABLES} where they overlap). */
export const AUTH_MODEL_DEFAULT_TABLES: Readonly<Record<AuthCoreModel, string>> = {
  user: AUTH_TABLES.identities,
  account: AUTH_TABLES.credentials,
  session: AUTH_TABLES.sessions,
  refreshToken: AUTH_TABLES.refreshTokens,
  verification: "oke_verifications",
  roles: AUTH_TABLES.roles,
  apiKeys: AUTH_TABLES.apiKeys,
};

/** SQL type hint for generated columns. */
export type AuthColumnSqlType = "TEXT" | "INTEGER" | "REAL" | "BLOB";

/** One resolved column for schema generate / DDL. */
export interface ResolvedAuthColumn {
  readonly logical: string;
  readonly sqlName: string;
  readonly sqlType: AuthColumnSqlType;
  readonly primary?: boolean;
  readonly required?: boolean;
  readonly defaultValue?: unknown;
}

/** One resolved auth model. */
export interface ResolvedAuthModel {
  readonly model: AuthCoreModel;
  readonly tableName: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly columns: readonly ResolvedAuthColumn[];
  readonly additionalFields: Readonly<Record<string, AuthAdditionalField>>;
}

/** Fully resolved auth schema. */
export interface ResolvedAuthSchema {
  readonly models: Readonly<Record<AuthCoreModel, ResolvedAuthModel>>;
  /** All physical table names (sorted unique). */
  readonly tableNames: readonly string[];
}

/** Input bag for {@link resolveAuthSchema}. */
export interface AuthSchemaOptions {
  readonly user?: AuthModelOptions;
  readonly account?: AuthModelOptions;
  readonly session?: AuthModelOptions;
  readonly refreshToken?: AuthModelOptions;
  readonly verification?: AuthModelOptions;
  readonly roles?: AuthModelOptions;
  readonly apiKeys?: AuthModelOptions;
}

const CORE_SQL_TYPES: Readonly<Record<string, AuthColumnSqlType>> = {
  id: "TEXT",
  email: "TEXT",
  name: "TEXT",
  emailVerified: "INTEGER",
  image: "TEXT",
  createdAt: "INTEGER",
  updatedAt: "INTEGER",
  status: "TEXT",
  userId: "TEXT",
  provider: "TEXT",
  providerAccountId: "TEXT",
  passwordHash: "TEXT",
  principalId: "TEXT",
  plane: "TEXT",
  familyId: "TEXT",
  revokedAt: "INTEGER",
  expiresAt: "INTEGER",
  lastActiveAt: "INTEGER",
  sessionId: "TEXT",
  hash: "TEXT",
  usedAt: "INTEGER",
  identifier: "TEXT",
  value: "TEXT",
  description: "TEXT",
  scopes: "TEXT",
  audience: "TEXT",
  lastUsedAt: "INTEGER",
};

/**
 * Map an additional-field type to a SQL column type.
 *
 * @param type - Declared field type
 */
export function authFieldSqlType(type: AuthFieldType): AuthColumnSqlType {
  switch (type) {
    case "number":
      return "INTEGER";
    case "boolean":
      return "INTEGER";
    case "json":
      return "TEXT";
    default:
      return "TEXT";
  }
}

/**
 * Resolve core auth schema with defaults + caller overrides.
 *
 * @param options - Per-model customization from `gate.auth`
 */
export function resolveAuthSchema(options: AuthSchemaOptions = {}): ResolvedAuthSchema {
  const models = {} as Record<AuthCoreModel, ResolvedAuthModel>;
  const tableNames = new Set<string>();

  for (const model of Object.keys(AUTH_MODEL_DEFAULT_TABLES) as AuthCoreModel[]) {
    const opts = options[model] ?? {};
    const defaults = AUTH_MODEL_DEFAULT_FIELDS[model];
    const fields: Record<string, string> = { ...defaults, ...(opts.fields ?? {}) };
    const additional = opts.additionalFields ?? {};
    const tableName = opts.modelName ?? AUTH_MODEL_DEFAULT_TABLES[model];
    tableNames.add(tableName);

    const columns: ResolvedAuthColumn[] = [];
    for (const [logical, sqlName] of Object.entries(fields)) {
      columns.push({
        logical,
        sqlName,
        sqlType: CORE_SQL_TYPES[logical] ?? "TEXT",
        primary: logical === "id",
        required: logical === "id" || logical === "email" || logical === "principalId",
      });
    }
    for (const [key, field] of Object.entries(additional)) {
      columns.push({
        logical: key,
        sqlName: field.fieldName ?? fields[key] ?? key,
        sqlType: authFieldSqlType(field.type),
        required: field.required === true,
        defaultValue: field.defaultValue,
      });
    }

    models[model] = {
      model,
      tableName,
      fields,
      columns,
      additionalFields: additional,
    };
  }

  return {
    models,
    tableNames: [...tableNames].sort(),
  };
}
