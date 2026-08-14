/**
 * App-plane initial schema for the keel seed — Gate auth + `oke schema generate`
 * system tables in `public` (`sql:db`). Console operator tables stay in
 * `oke_console` and are not declared here.
 */

import { AUTH_TABLES } from "../../auth/tables.ts";
import { resolveAuthSchema } from "../../auth/schema.ts";
import type { DeclaredColumn, Table } from "../../manifest/types.ts";

const PII_COLUMNS = new Set([
  "email",
  "identifier",
  "password_hash",
  "hash",
  "value",
  "encrypted_value",
  "encrypted_dek",
  "wrapped_master",
  "key_hash",
]);

const SENSITIVE_COLUMNS = new Set([
  "password_hash",
  "hash",
  "value",
  "encrypted_value",
  "encrypted_dek",
  "wrapped_master",
  "key_hash",
]);

function col(type: "text" | "integer", extras: Omit<DeclaredColumn, "type"> = {}): DeclaredColumn {
  return { type, ...extras };
}

function authTablesFromSchema(): Record<string, Table> {
  const resolved = resolveAuthSchema();
  const tables: Record<string, Table> = {};
  for (const model of Object.values(resolved.models)) {
    const columns: Record<string, DeclaredColumn> = {};
    for (const field of model.columns) {
      columns[field.sqlName] = col(field.sqlType === "INTEGER" ? "integer" : "text", {
        ...(field.primary ? { primaryKey: true } : {}),
        ...(field.required ? {} : { nullable: true }),
        ...(PII_COLUMNS.has(field.sqlName) ? { pii: true } : {}),
        ...(SENSITIVE_COLUMNS.has(field.sqlName) ? { sensitive: true } : {}),
      });
    }
    tables[model.tableName] = { columns };
  }
  tables[AUTH_TABLES.roleGrants] = {
    columns: {
      id: col("text", { primaryKey: true }),
      role_id: col("text"),
      action: col("text"),
    },
  };
  tables[AUTH_TABLES.identityRoles] = {
    columns: {
      id: col("text", { primaryKey: true }),
      identity_id: col("text"),
      role_id: col("text"),
    },
  };
  return tables;
}

const CORE_SYSTEM_TABLES: Record<string, Table> = {
  oke_overrides: {
    columns: {
      id: col("text", { primaryKey: true }),
      name: col("text"),
      kind: col("text"),
      field: col("text"),
      value: col("text"),
      updated_at: col("integer"),
    },
  },
  oke_crons: {
    columns: {
      name: col("text", { primaryKey: true }),
      declared_cron: col("text", { nullable: true }),
      declared_every: col("text", { nullable: true }),
      override_every: col("text", { nullable: true }),
      timezone: col("text"),
      overridable: col("integer"),
      status: col("text"),
      last_run_at: col("integer", { nullable: true }),
      next_run_at: col("integer", { nullable: true }),
    },
  },
  oke_signal_config: {
    columns: {
      name: col("text", { primaryKey: true }),
      delivery: col("text"),
      retries: col("integer"),
      dead_letter: col("integer"),
      status: col("text"),
    },
  },
  oke_vault_secrets: {
    columns: {
      id: col("text", { primaryKey: true }),
      path: col("text"),
      encrypted_value: col("text", { pii: true, sensitive: true }),
      version: col("integer"),
      algorithm: col("text"),
      kek_version: col("integer"),
      created_at: col("text"),
    },
  },
  oke_vault_keys: {
    columns: {
      id: col("text", { primaryKey: true }),
      secret_id: col("text"),
      encrypted_dek: col("text", { pii: true, sensitive: true }),
      algorithm: col("text"),
      kek_version: col("integer"),
      created_at: col("text"),
    },
  },
  oke_vault_audit: {
    columns: {
      id: col("text", { primaryKey: true }),
      seq: col("integer"),
      action: col("text"),
      path: col("text", { nullable: true }),
      actor_type: col("text"),
      actor_id: col("text", { nullable: true }),
      success: col("integer"),
      created_at: col("text"),
    },
  },
  oke_vault_master: {
    columns: {
      id: col("text", { primaryKey: true }),
      key_hash: col("text", { pii: true, sensitive: true }),
      kek_version: col("integer"),
      created_at: col("text"),
    },
  },
  oke_vault_status: {
    columns: {
      id: col("integer", { primaryKey: true }),
      sealed: col("integer"),
      initialized: col("integer"),
      master_key_present: col("integer"),
      seal_count: col("integer"),
      updated_at: col("text"),
    },
  },
};

/**
 * Manifest `stores.db.tables` entries for Gate auth + core runtime tables.
 */
export const UI_NEXT_SEED_APP_SYSTEM_TABLES: Record<string, Table> = {
  ...authTablesFromSchema(),
  ...CORE_SYSTEM_TABLES,
};

const NOW = 1_723_622_400_000;
const LATER = NOW + 30 * 24 * 60 * 60 * 1000;

const PEOPLE = [
  { id: "user_demo", email: "demo@example.com", name: "Demo User", status: "active" },
  { id: "user_member", email: "member@example.com", name: "Member", status: "active" },
  { id: "idn_aria", email: "aria@keel.dev", name: "Aria Chen", status: "active" },
  { id: "idn_ben", email: "ben@keel.dev", name: "Ben Okonkwo", status: "active" },
  { id: "idn_cai", email: "cai@keel.dev", name: "Cai Moreno", status: "active" },
  { id: "idn_dia", email: "dia@keel.dev", name: "Dia Farouk", status: "active" },
  { id: "idn_eli", email: "eli@keel.dev", name: "Eli Park", status: "active" },
  { id: "idn_nora", email: "nora@keel.dev", name: "Nora Singh", status: "active" },
  { id: "idn_omar", email: "omar@keel.dev", name: "Omar Haddad", status: "active" },
  { id: "idn_priya", email: "priya@keel.dev", name: "Priya Shah", status: "active" },
  { id: "idn_quin", email: "quin@keel.dev", name: "Quin Walsh", status: "active" },
  { id: "idn_rosa", email: "rosa@keel.dev", name: "Rosa Alvarez", status: "active" },
  { id: "idn_samir", email: "samir@keel.dev", name: "Samir Cole", status: "active" },
  { id: "idn_tess", email: "tess@keel.dev", name: "Tess Nguyen", status: "active" },
  { id: "idn_uma", email: "uma@keel.dev", name: "Uma Berg", status: "active" },
  { id: "idn_vik", email: "vik@keel.dev", name: "Vik Noor", status: "active" },
  { id: "idn_wen", email: "wen@keel.dev", name: "Wen Li", status: "active" },
  { id: "idn_yael", email: "yael@keel.dev", name: "Yael Cohen", status: "active" },
  { id: "idn_zio", email: "zio@keel.dev", name: "Zio Hart", status: "active" },
] as const;

/**
 * Seeded rows for app-plane system tables (never secret values).
 */
export const UI_NEXT_SEED_APP_SYSTEM_ROWS: Readonly<Record<string, readonly object[]>> = {
  [AUTH_TABLES.identities]: PEOPLE.map((p) => ({
    id: p.id,
    email: p.email,
    name: p.name,
    email_verified: 1,
    image: null,
    created_at: NOW,
    updated_at: NOW,
    status: p.status,
  })),
  [AUTH_TABLES.credentials]: PEOPLE.map((p) => ({
    id: `acc_${p.id}`,
    user_id: p.id,
    provider: "credential",
    provider_account_id: p.email,
    password_hash: `argon2id$keel$${p.id}`,
    created_at: NOW,
    updated_at: NOW,
  })),
  [AUTH_TABLES.identityRoles]: [
    ...PEOPLE.map((p) => ({
      id: `ir_${p.id}_member`,
      identity_id: p.id,
      role_id: "role_member",
    })),
    { id: "ir_idn_aria_staff", identity_id: "idn_aria", role_id: "role_staff" },
    { id: "ir_user_demo_staff", identity_id: "user_demo", role_id: "role_staff" },
  ],
  [AUTH_TABLES.roles]: [
    { id: "role_member", name: "member", plane: "user", description: "Signed-in workspace member" },
    { id: "role_staff", name: "staff", plane: "user", description: "May accept triage" },
    {
      id: "role_issue_write",
      name: "issue:write",
      plane: "user",
      description: "May create and update issues",
    },
    {
      id: "role_team_admin",
      name: "team:admin",
      plane: "user",
      description: "May create teams and close cycles",
    },
  ],
  [AUTH_TABLES.roleGrants]: [
    { id: "rg_1", role_id: "role_member", action: "member" },
    { id: "rg_2", role_id: "role_staff", action: "member" },
    { id: "rg_3", role_id: "role_staff", action: "triage:accept" },
    { id: "rg_4", role_id: "role_issue_write", action: "issue:write" },
    { id: "rg_5", role_id: "role_issue_write", action: "project:admin" },
    { id: "rg_6", role_id: "role_issue_write", action: "comment:write" },
    { id: "rg_7", role_id: "role_issue_write", action: "files:write" },
    { id: "rg_8", role_id: "role_team_admin", action: "team:admin" },
    { id: "rg_9", role_id: "role_team_admin", action: "member:admin" },
    { id: "rg_10", role_id: "role_team_admin", action: "webhook:admin" },
  ],
  [AUTH_TABLES.apiKeys]: [
    {
      id: "key_keel_ci",
      plane: "user",
      hash: "sha256$keel_ci",
      name: "Keel CI",
      scopes: "member,issue:write",
      expires_at: null,
      created_at: NOW,
      last_used_at: NOW - 3_600_000,
      revoked_at: null,
    },
    {
      id: "key_keel_mcp",
      plane: "user",
      hash: "sha256$keel_mcp",
      name: "Keel MCP",
      scopes: "member",
      expires_at: LATER,
      created_at: NOW,
      last_used_at: null,
      revoked_at: null,
    },
  ],
  [AUTH_TABLES.sessions]: [
    {
      id: "ses_aria",
      principal_id: "idn_aria",
      plane: "user",
      family_id: "fam_aria",
      revoked_at: null,
      created_at: NOW,
      expires_at: LATER,
      last_active_at: NOW,
      scopes: "member,issue:write",
      audience: "oke-app",
    },
    {
      id: "ses_demo",
      principal_id: "user_demo",
      plane: "user",
      family_id: "fam_demo",
      revoked_at: null,
      created_at: NOW,
      expires_at: LATER,
      last_active_at: NOW,
      scopes: "member,issue:write",
      audience: "oke-app",
    },
  ],
  [AUTH_TABLES.refreshTokens]: [
    {
      id: "rt_aria",
      session_id: "ses_aria",
      family_id: "fam_aria",
      hash: "sha256$rt_aria",
      expires_at: LATER,
      used_at: null,
      revoked_at: null,
    },
    {
      id: "rt_demo",
      session_id: "ses_demo",
      family_id: "fam_demo",
      hash: "sha256$rt_demo",
      expires_at: LATER,
      used_at: null,
      revoked_at: null,
    },
  ],
  [AUTH_TABLES.verifications]: [
    {
      id: "ver_magic_cai",
      identifier: "cai@keel.dev",
      value: "sealed:otp",
      expires_at: NOW + 15 * 60 * 1000,
      created_at: NOW,
    },
  ],
  oke_overrides: [
    {
      id: "ovr_expire_drafts",
      name: "expire-drafts",
      kind: "clock",
      field: "every",
      value: "15m",
      updated_at: NOW,
    },
  ],
  oke_crons: [
    {
      name: "close-cycles",
      declared_cron: "0 3 * * 1",
      declared_every: null,
      override_every: null,
      timezone: "UTC",
      overridable: 0,
      status: "active",
      last_run_at: NOW - 86_400_000,
      next_run_at: NOW + 86_400_000,
    },
    {
      name: "expire-drafts",
      declared_cron: null,
      declared_every: "10m",
      override_every: "15m",
      timezone: "UTC",
      overridable: 1,
      status: "active",
      last_run_at: NOW - 600_000,
      next_run_at: NOW + 300_000,
    },
    {
      name: "watch-sla",
      declared_cron: null,
      declared_every: "15m",
      override_every: null,
      timezone: "UTC",
      overridable: 0,
      status: "active",
      last_run_at: NOW - 900_000,
      next_run_at: NOW + 900_000,
    },
    {
      name: "daily-digest",
      declared_cron: "0 8 * * *",
      declared_every: null,
      override_every: null,
      timezone: "UTC",
      overridable: 0,
      status: "active",
      last_run_at: NOW - 86_400_000,
      next_run_at: NOW + 36_000_000,
    },
    {
      name: "nudge-stale",
      declared_cron: null,
      declared_every: "1h",
      override_every: null,
      timezone: "UTC",
      overridable: 0,
      status: "active",
      last_run_at: NOW - 3_600_000,
      next_run_at: NOW + 3_600_000,
    },
    {
      name: "reconcile-github",
      declared_cron: "0 */6 * * *",
      declared_every: null,
      override_every: null,
      timezone: "UTC",
      overridable: 0,
      status: "active",
      last_run_at: NOW - 21_600_000,
      next_run_at: NOW + 21_600_000,
    },
  ],
  oke_signal_config: [
    { name: "issue-created", delivery: "once", retries: 3, dead_letter: 1, status: "active" },
    { name: "comment-added", delivery: "live", retries: 3, dead_letter: 1, status: "active" },
    { name: "cycle-closed", delivery: "broadcast", retries: 3, dead_letter: 1, status: "active" },
    { name: "sla-breaching", delivery: "once", retries: 3, dead_letter: 1, status: "active" },
    { name: "draft-expired", delivery: "broadcast", retries: 3, dead_letter: 1, status: "active" },
    { name: "issue-updated", delivery: "once", retries: 3, dead_letter: 1, status: "active" },
    { name: "issue-archived", delivery: "broadcast", retries: 3, dead_letter: 1, status: "active" },
    { name: "issue-reassigned", delivery: "live", retries: 3, dead_letter: 1, status: "active" },
    {
      name: "project-updated",
      delivery: "broadcast",
      retries: 3,
      dead_letter: 1,
      status: "active",
    },
    { name: "comment-resolved", delivery: "once", retries: 3, dead_letter: 1, status: "active" },
    { name: "member-joined", delivery: "broadcast", retries: 3, dead_letter: 1, status: "active" },
  ],
  oke_vault_secrets: [
    vaultSecret("GITHUB_TOKEN", 1),
    vaultSecret("OPENAI_KEY", 2),
    vaultSecret("SLACK_WEBHOOK", 3),
    vaultSecret("WEBHOOK_SECRET", 4),
    vaultSecret("SLACK_BOT", 5),
  ],
  oke_vault_keys: [
    vaultKey("GITHUB_TOKEN", 1),
    vaultKey("OPENAI_KEY", 2),
    vaultKey("SLACK_WEBHOOK", 3),
    vaultKey("WEBHOOK_SECRET", 4),
    vaultKey("SLACK_BOT", 5),
  ],
  oke_vault_audit: [
    {
      id: "aud_1",
      seq: 1,
      action: "init",
      path: null,
      actor_type: "system",
      actor_id: null,
      success: 1,
      created_at: "2026-07-01T00:00:00Z",
    },
    {
      id: "aud_2",
      seq: 2,
      action: "set",
      path: "GITHUB_TOKEN",
      actor_type: "operator",
      actor_id: "idn_aria",
      success: 1,
      created_at: "2026-07-01T00:01:00Z",
    },
    {
      id: "aud_3",
      seq: 3,
      action: "set",
      path: "OPENAI_KEY",
      actor_type: "operator",
      actor_id: "idn_aria",
      success: 1,
      created_at: "2026-07-01T00:02:00Z",
    },
    {
      id: "aud_4",
      seq: 4,
      action: "set",
      path: "SLACK_WEBHOOK",
      actor_type: "operator",
      actor_id: "idn_aria",
      success: 1,
      created_at: "2026-07-01T00:03:00Z",
    },
  ],
  oke_vault_master: [
    {
      id: "mst_1",
      key_hash: "sha256$master",
      kek_version: 1,
      created_at: "2026-07-01T00:00:00Z",
    },
  ],
  oke_vault_status: [
    {
      id: 1,
      sealed: 0,
      initialized: 1,
      master_key_present: 1,
      seal_count: 0,
      updated_at: "2026-08-14T00:00:00Z",
    },
  ],
};

function vaultSecret(path: string, n: number): object {
  return {
    id: `sec_${n}`,
    path,
    encrypted_value: `sealed:${path}:v1`,
    version: 1,
    algorithm: "aes-256-gcm",
    kek_version: 1,
    created_at: "2026-07-01T00:00:00Z",
  };
}

function vaultKey(path: string, n: number): object {
  return {
    id: `dek_${n}`,
    secret_id: `sec_${n}`,
    encrypted_dek: `sealed:dek:${path}`,
    algorithm: "aes-256-gcm",
    kek_version: 1,
    created_at: "2026-07-01T00:00:00Z",
  };
}

/** Seeded row counts for app-plane system tables. */
export const UI_NEXT_SEED_APP_SYSTEM_COUNTS = Object.fromEntries(
  Object.entries(UI_NEXT_SEED_APP_SYSTEM_ROWS).map(([name, rows]) => [name, rows.length]),
) as Readonly<Record<string, number>>;
