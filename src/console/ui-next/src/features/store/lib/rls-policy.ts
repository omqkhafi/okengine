/**
 * Console helpers for RLS policy create (SQL preview + templates).
 */

import {
  buildCreatePolicySql,
  buildRowSecuritySql,
  parseSqlPolicySpec,
  quotePgIdent,
  type SqlPolicyBehavior,
  type SqlPolicyCommand,
  type SqlPolicySpec,
} from "../../../../../../drivers/pg-rls.ts";

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

const OKE_GATE = "current_setting('oke.gate', true)";

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
    detail: "SELECT when a text owner column matches current_user.",
    command: "SELECT",
    using: "owner = current_user",
  },
  {
    id: "gate-read",
    name: "gate_read",
    title: "Enable read when oke.gate matches",
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
    using:
      "exists (select 1 from members m where m.user_id = current_user and m.team_id = team_id)",
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
    detail: "INSERT WITH CHECK so new rows set owner to current_user.",
    command: "INSERT",
    withCheck: "owner = current_user",
  },
  {
    id: "insert-gate",
    name: "insert_gate",
    title: "Enable insert when oke.gate matches",
    detail: `INSERT WITH CHECK when ${OKE_GATE} equals a Gate name.`,
    command: "INSERT",
    withCheck: `${OKE_GATE} = 'member'`,
  },
  {
    id: "update-owner",
    name: "update_owner",
    title: "Enable update for owners",
    detail: "UPDATE own rows. USING and WITH CHECK both require owner = current_user.",
    command: "UPDATE",
    using: "owner = current_user",
    withCheck: "owner = current_user",
  },
  {
    id: "update-gate",
    name: "update_gate",
    title: "Enable update when oke.gate matches",
    detail: `UPDATE when ${OKE_GATE} equals a Gate name.`,
    command: "UPDATE",
    using: `${OKE_GATE} = 'member'`,
    withCheck: `${OKE_GATE} = 'member'`,
  },
  {
    id: "delete-owner",
    name: "delete_owner",
    title: "Enable delete for owners",
    detail: "DELETE when a text owner column matches current_user.",
    command: "DELETE",
    using: "owner = current_user",
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
    detail: "ALL commands when owner = current_user (USING and WITH CHECK).",
    command: "ALL",
    using: "owner = current_user",
    withCheck: "owner = current_user",
  },
  {
    id: "all-gate",
    name: "gate_all",
    title: "Enable all commands when oke.gate matches",
    detail: `ALL commands when ${OKE_GATE} equals a Gate name.`,
    command: "ALL",
    using: `${OKE_GATE} = 'member'`,
    withCheck: `${OKE_GATE} = 'member'`,
  },
  {
    id: "restrictive-gate",
    name: "restrictive_gate",
    title: "Restrictive extra Gate check",
    detail: "RESTRICTIVE policy ANDs with permissive ones. Requires oke.gate to be set.",
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
export function rlsPolicyPreviewSql(spec: SqlPolicySpec, enableRls: boolean): string {
  const create = formatCreatePolicyPreview(spec);
  if (!enableRls) return `${create};`;
  return `${buildRowSecuritySql(spec.table, true)};\n${create};`;
}

function formatCreatePolicyPreview(spec: SqlPolicySpec): string {
  const roles =
    spec.roles.length === 0
      ? "public"
      : spec.roles.map((role) => (role === "public" ? "public" : quotePgIdent(role))).join(", ");
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
