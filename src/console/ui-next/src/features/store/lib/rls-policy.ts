/**
 * Console helpers for RLS policy create (SQL preview + templates).
 */

import type {
  ColumnClassification,
  DeclaredColumn,
  Manifest,
  Table,
} from "../../../../../../manifest/types.ts";
import {
  buildCreatePolicySql,
  buildRowSecuritySql,
  parseSqlPolicySpec,
  quotePgIdent,
  formatPolicyRole,
  emitPgPolicySource,
  emitStoreSchemaPolicySource,
  type SqlPolicyBehavior,
  type SqlPolicyCommand,
  type SqlPolicySpec,
} from "../../../../../../drivers/pg-rls.ts";
import { fkColumnStem } from "./schema-graph.ts";

export { emitPgPolicySource, emitStoreSchemaPolicySource };

export type { SqlPolicyBehavior, SqlPolicyCommand, SqlPolicySpec };
export { buildCreatePolicySql, buildRowSecuritySql, parseSqlPolicySpec };

/** One starter template for the create-policy sheet. */
export type RlsPolicyTemplate = {
  readonly id: string;
  /** SQL policy name applied when the card is picked. */
  readonly name: string;
  readonly title: string;
  readonly detail: string;
  readonly command: SqlPolicyCommand;
  readonly behavior?: SqlPolicyBehavior;
  readonly using?: string;
  readonly withCheck?: string;
};

const OKE_GATE = "oke.gate()";
const OKE_USER = "oke.user()";

/** Common Postgres RLS starters — OKE Gate / owner / join, no vendor auth helpers. */
export const RLS_POLICY_TEMPLATES: readonly RlsPolicyTemplate[] = [
  {
    id: "read-all",
    name: "read_all",
    title: "Enable read access for everyone",
    detail: "SELECT using true. Any role that reaches the table can read.",
    command: "SELECT",
    using: "true",
  },
  {
    id: "deny-read",
    name: "deny_read",
    title: "Deny all reads",
    detail: "SELECT using false. Rows stay hidden until another policy allows them.",
    command: "SELECT",
    using: "false",
  },
  {
    id: "owner-read",
    name: "owner_read",
    title: "Enable read for owners",
    detail: "SELECT when a text owner column matches oke.user().",
    command: "SELECT",
    using: `owner = ${OKE_USER}`,
  },
  {
    id: "gate-read",
    name: "gate_read",
    title: "Enable read when oke.gate() matches",
    detail: `SELECT when ${OKE_GATE} equals a Gate name (pair Policy & scope).`,
    command: "SELECT",
    using: `${OKE_GATE} = 'member'`,
  },
  {
    id: "join-read",
    name: "join_read",
    title: "Enable read via a related table",
    detail: "SELECT with EXISTS against members — membership joins, not a column on this table.",
    command: "SELECT",
    using: "exists (select 1 from members m where m.user_id = oke.user() and m.team_id = team_id)",
  },
  {
    id: "insert-all",
    name: "insert_all",
    title: "Enable insert for everyone",
    detail: "INSERT WITH CHECK true. New rows are accepted without a row predicate.",
    command: "INSERT",
    withCheck: "true",
  },
  {
    id: "insert-owner",
    name: "insert_owner",
    title: "Enable insert for owners",
    detail: "INSERT WITH CHECK so new rows set owner to oke.user().",
    command: "INSERT",
    withCheck: `owner = ${OKE_USER}`,
  },
  {
    id: "insert-gate",
    name: "insert_gate",
    title: "Enable insert when oke.gate() matches",
    detail: `INSERT WITH CHECK when ${OKE_GATE} equals a Gate name.`,
    command: "INSERT",
    withCheck: `${OKE_GATE} = 'member'`,
  },
  {
    id: "update-owner",
    name: "update_owner",
    title: "Enable update for owners",
    detail: "UPDATE own rows. USING and WITH CHECK both require owner = oke.user().",
    command: "UPDATE",
    using: `owner = ${OKE_USER}`,
    withCheck: `owner = ${OKE_USER}`,
  },
  {
    id: "update-gate",
    name: "update_gate",
    title: "Enable update when oke.gate() matches",
    detail: `UPDATE when ${OKE_GATE} equals a Gate name.`,
    command: "UPDATE",
    using: `${OKE_GATE} = 'member'`,
    withCheck: `${OKE_GATE} = 'member'`,
  },
  {
    id: "delete-owner",
    name: "delete_owner",
    title: "Enable delete for owners",
    detail: "DELETE when a text owner column matches oke.user().",
    command: "DELETE",
    using: `owner = ${OKE_USER}`,
  },
  {
    id: "deny-delete",
    name: "deny_delete",
    title: "Deny all deletes",
    detail: "DELETE using false. Rows cannot be removed until another policy allows it.",
    command: "DELETE",
    using: "false",
  },
  {
    id: "all-owner",
    name: "owner_all",
    title: "Enable all commands for owners",
    detail: "ALL commands when owner = oke.user() (USING and WITH CHECK).",
    command: "ALL",
    using: `owner = ${OKE_USER}`,
    withCheck: `owner = ${OKE_USER}`,
  },
  {
    id: "all-gate",
    name: "gate_all",
    title: "Enable all commands when oke.gate() matches",
    detail: `ALL commands when ${OKE_GATE} equals a Gate name.`,
    command: "ALL",
    using: `${OKE_GATE} = 'member'`,
    withCheck: `${OKE_GATE} = 'member'`,
  },
  {
    id: "restrictive-gate",
    name: "restrictive_gate",
    title: "Restrictive extra Gate check",
    detail: "RESTRICTIVE policy ANDs with permissive ones. Requires oke.gate() to be set.",
    command: "ALL",
    behavior: "RESTRICTIVE",
    using: `${OKE_GATE} is not null`,
    withCheck: `${OKE_GATE} is not null`,
  },
];

/**
 * Filter templates by title, detail, command, or policy name.
 *
 * @param templates - Full library
 * @param query - Search text
 */
export function filterRlsPolicyTemplates(
  templates: readonly RlsPolicyTemplate[],
  query: string,
): readonly RlsPolicyTemplate[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return templates;
  return templates.filter((tpl) =>
    [tpl.id, tpl.name, tpl.title, tpl.detail, tpl.command, tpl.behavior ?? ""].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

/** Every `FOR` command the Advanced Gate picker can set. */
export const RLS_POLICY_COMMANDS: readonly SqlPolicyCommand[] = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "ALL",
];

/** Which `CREATE POLICY` predicates a command accepts. */
export type RlsPolicyPredicates = {
  readonly using: boolean;
  readonly withCheck: boolean;
};

/**
 * `USING` / `WITH CHECK` visibility for a `FOR` command.
 *
 * @param command - Policy `FOR` command
 */
export function rlsPolicyPredicates(command: SqlPolicyCommand): RlsPolicyPredicates {
  if (command === "INSERT") return { using: false, withCheck: true };
  if (command === "UPDATE" || command === "ALL") return { using: true, withCheck: true };
  return { using: true, withCheck: false };
}

/** Gate posture that maps onto this policy's SQL command. */
export type RlsGateMode = "read" | "write" | "both";

/**
 * Gate Module:Action pairs for a command (`store.sql:read` / `store.sql:write`).
 *
 * @param command - Policy `FOR` command
 */
export function rlsStoreGateActions(command: SqlPolicyCommand): readonly string[] {
  return rlsGateActionsForMode(rlsGateModeFromCommand(command));
}

/**
 * Read / write / both from a SQL command.
 *
 * @param command - Policy `FOR` command
 */
export function rlsGateModeFromCommand(command: SqlPolicyCommand): RlsGateMode {
  if (command === "SELECT") return "read";
  if (command === "ALL") return "both";
  return "write";
}

/**
 * SQL command from a Gate posture. Write keeps INSERT / UPDATE / DELETE.
 *
 * @param mode - Selected Gate posture
 * @param previous - Current command
 */
export function rlsCommandFromGateMode(
  mode: RlsGateMode,
  previous: SqlPolicyCommand,
): SqlPolicyCommand {
  if (mode === "read") return "SELECT";
  if (mode === "both") return "ALL";
  if (previous === "INSERT" || previous === "UPDATE" || previous === "DELETE") return previous;
  return "INSERT";
}

/**
 * Module:Action pairs for a Gate posture.
 *
 * @param mode - Selected Gate posture
 */
export function rlsGateActionsForMode(mode: RlsGateMode): readonly string[] {
  if (mode === "read") return ["store.sql:read"];
  if (mode === "write") return ["store.sql:write"];
  return ["store.sql:read", "store.sql:write"];
}

/**
 * Build CREATE POLICY (+ optional ENABLE RLS) for the review pane.
 *
 * @param spec - Policy fields
 * @param enableRls - Also enable RLS on the table
 */
/**
 * Code-dock sources: `store.schema.policy` plus Drizzle `pgPolicy`.
 *
 * @param spec - Policy fields
 */
export function rlsPolicyCodeSource(spec: SqlPolicySpec): string {
  return `${emitStoreSchemaPolicySource(spec)}\n\n${emitPgPolicySource(spec)}`;
}

/**
 * USING / WITH CHECK from Advanced Gate picks (never Postgres `TO`).
 *
 * @param gates - Selected policy / public / scope names
 */
export function rlsGatePredicateSql(gates: readonly string[]): string {
  if (gates.length === 0) return "true";
  return gates
    .map((gate) => {
      const lit = `'${gate.replaceAll("'", "''")}'`;
      return gate.includes(":") ? `oke.has_scope(${lit})` : `oke.gate() = ${lit}`;
    })
    .join(" OR ");
}

export function rlsPolicyPreviewSql(spec: SqlPolicySpec, enableRls: boolean): string {
  const create = formatCreatePolicyPreview(spec);
  if (!enableRls) return `${create};`;
  return `${buildRowSecuritySql(spec.table, true)};\n${create};`;
}

/** SQL names owner templates bind to, first match wins. */
const OWNER_SQL_NAMES = [
  "owner",
  "owner_id",
  "owner_email",
  "user_id",
  "created_by",
  "creator",
  "creator_id",
  "creator_email",
  "author",
  "author_id",
  "author_email",
] as const;

/** One Manifest column for the identity select (PK / FK / unique marks). */
export type RlsTableColumn = {
  readonly sqlName: string;
  readonly primaryKey: boolean;
  readonly foreignKey: boolean;
  readonly unique: boolean;
  /** FK inferred from `*_id` when Manifest omitted `.references()`. */
  readonly inferred: boolean;
};

/**
 * Manifest columns with PK / FK / unique marks (`sqlName`, else snake_case).
 *
 * @param manifest - Current Manifest, or null
 * @param storeRef - Store effect ref (`sql:db`)
 * @param table - Table name
 */
export function rlsTableColumns(
  manifest: Manifest | null,
  storeRef: string,
  table: string,
): readonly RlsTableColumn[] {
  const cut = storeRef.indexOf(":");
  const storeName = cut >= 0 ? storeRef.slice(cut + 1) : storeRef;
  const cols = manifest?.stores?.[storeName]?.tables?.[table]?.columns ?? {};
  return Object.entries(cols).map(([key, col]) => {
    const sqlName = sqlNameOf(key, col);
    const declared = isDeclaredColumn(col) ? col : null;
    const primaryKey = declared?.primaryKey === true;
    const declaredFk = declared?.references?.table !== undefined;
    const inferred = !declaredFk && !primaryKey && fkColumnStem(sqlName) !== null;
    return {
      sqlName,
      primaryKey,
      foreignKey: declaredFk || inferred,
      unique: declared?.unique === true && !primaryKey,
      inferred,
    };
  });
}

/**
 * SQL column names on a Manifest table (`sqlName`, else snake_case key).
 *
 * @param manifest - Current Manifest, or null
 * @param storeRef - Store effect ref (`sql:db`)
 * @param table - Table name
 */
export function rlsTableSqlColumns(
  manifest: Manifest | null,
  storeRef: string,
  table: string,
): readonly string[] {
  return rlsTableColumns(manifest, storeRef, table).map((col) => col.sqlName);
}

function isDeclaredColumn(col: DeclaredColumn | ColumnClassification): col is DeclaredColumn {
  return (
    "type" in col ||
    "nullable" in col ||
    "primaryKey" in col ||
    "unique" in col ||
    "sqlName" in col ||
    "description" in col ||
    "references" in col ||
    "default" in col
  );
}

/**
 * Best owner-like SQL column for owner templates, or null.
 *
 * @param sqlNames - Table SQL column names
 */
export function rlsOwnerColumn(sqlNames: readonly string[]): string | null {
  const byLower = new Map(sqlNames.map((name) => [name.toLowerCase(), name]));
  for (const name of OWNER_SQL_NAMES) {
    const hit = byLower.get(name);
    if (hit) return hit;
  }
  return null;
}

/**
 * Replace the generic `owner` placeholder with the table's owner column.
 *
 * @param expr - USING / WITH CHECK body
 * @param ownerCol - SQL column to bind
 */
export function rlsBindOwnerExpr(expr: string, ownerCol: string): string {
  return expr.replace(/\bowner\b/g, ownerCol);
}

/**
 * True when the expression still uses the unbound `owner` placeholder.
 *
 * @param expr - USING / WITH CHECK body
 */
export function rlsExprNeedsOwnerColumn(expr: string): boolean {
  return /\bowner\b/.test(expr);
}

/**
 * True when a template compares a row to `oke.user()` via `owner`.
 *
 * @param tpl - Policy template
 */
export function rlsTemplateUsesOwner(tpl: Pick<RlsPolicyTemplate, "using" | "withCheck">): boolean {
  return rlsExprNeedsOwnerColumn(tpl.using ?? "") || rlsExprNeedsOwnerColumn(tpl.withCheck ?? "");
}

/**
 * True when the expression is an owner / `oke.user()` identity check.
 *
 * @param expr - USING / WITH CHECK body
 */
export function rlsExprUsesUserIdentity(expr: string): boolean {
  return rlsExprNeedsOwnerColumn(expr) || /oke\.user\(\)/.test(expr);
}

/**
 * Rewrite `owner` or a previous identity column to `to`.
 *
 * @param expr - USING / WITH CHECK body
 * @param from - Previous SQL column (or `owner`)
 * @param to - Selected SQL column
 */
export function rlsRewriteIdentityColumn(expr: string, from: string, to: string): string {
  if (!to || from === to) return expr;
  let next = expr;
  if (rlsExprNeedsOwnerColumn(next)) next = rlsBindOwnerExpr(next, to);
  if (from !== "" && from !== "owner") {
    next = next.replace(new RegExp(`\\b${escapeIdent(from)}\\b`, "g"), to);
  }
  return next;
}

function escapeIdent(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sqlNameOf(key: string, col: NonNullable<Table["columns"]>[string]): string {
  if (col && typeof col === "object" && "sqlName" in col && typeof col.sqlName === "string") {
    return col.sqlName;
  }
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function formatCreatePolicyPreview(spec: SqlPolicySpec): string {
  const roles =
    spec.roles.length === 0
      ? "public"
      : spec.roles.map((role) => formatPolicyRole(role)).join(", ");
  const lines = [
    `CREATE POLICY ${quotePgIdent(spec.name)}`,
    `  ON ${quotePgIdent(spec.table)}`,
    `  AS ${spec.behavior}`,
    `  FOR ${spec.command}`,
    `  TO ${roles}`,
  ];
  if (spec.using !== undefined && spec.using.trim() !== "") {
    lines.push(`  USING (${spec.using.trim()})`);
  }
  if (spec.withCheck !== undefined && spec.withCheck.trim() !== "") {
    lines.push(`  WITH CHECK (${spec.withCheck.trim()})`);
  }
  return lines.join("\n");
}
