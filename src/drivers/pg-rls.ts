/**
 * Postgres row-level security — identifiers and `CREATE POLICY` SQL.
 */

/** Policy command (`FOR`). */
export type SqlPolicyCommand = "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";

/** Policy behavior (`AS`). */
export type SqlPolicyBehavior = "PERMISSIVE" | "RESTRICTIVE";

/** Fields for `CREATE POLICY`. */
export type SqlPolicySpec = {
  readonly name: string;
  readonly table: string;
  readonly command: SqlPolicyCommand;
  readonly behavior: SqlPolicyBehavior;
  readonly roles: readonly string[];
  readonly using?: string;
  readonly withCheck?: string;
};

/** Fields for `ALTER POLICY` (`TO` / `USING` / `WITH CHECK`). */
export type SqlPolicyAlterSpec = {
  readonly name: string;
  readonly table: string;
  readonly roles?: readonly string[];
  readonly using?: string;
  readonly withCheck?: string;
};

const POLICY_COMMANDS = new Set<string>(["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"]);
const POLICY_BEHAVIORS = new Set<string>(["PERMISSIVE", "RESTRICTIVE"]);

/**
 * Quote a Postgres identifier (`"`), stripping embedded quotes.
 *
 * @param name - Identifier
 */
export function quotePgIdent(name: string): string {
  return `"${name.replaceAll('"', "")}"`;
}

/**
 * True when `name` is a simple SQL identifier.
 *
 * @param name - Table or role
 */
export function isPgIdent(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(name);
}

/**
 * True when `name` is a safe policy name (spaces allowed).
 *
 * @param name - Policy name
 */
export function isPgPolicyName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_ -]{0,62}$/.test(name);
}

/**
 * True when `expr` is a single SQL expression (no statement stacking).
 *
 * @param expr - USING / WITH CHECK body
 */
export function isSafePolicyExpr(expr: string): boolean {
  const t = expr.trim();
  return t.length > 0 && t.length <= 2000 && !/;/.test(t) && !/--/.test(t) && !/\/\*/.test(t);
}

/**
 * Parse a policy command token.
 *
 * @param value - Raw command
 */
export function parseSqlPolicyCommand(value: unknown): SqlPolicyCommand | null {
  if (typeof value !== "string") return null;
  const u = value.trim().toUpperCase();
  return POLICY_COMMANDS.has(u) ? (u as SqlPolicyCommand) : null;
}

/**
 * Parse a policy behavior token.
 *
 * @param value - Raw behavior
 */
export function parseSqlPolicyBehavior(value: unknown): SqlPolicyBehavior | null {
  if (typeof value !== "string") return null;
  const u = value.trim().toUpperCase();
  return POLICY_BEHAVIORS.has(u) ? (u as SqlPolicyBehavior) : null;
}

/**
 * Split a roles field into identifiers (`public` allowed).
 *
 * @param raw - Comma-separated roles
 */
export function parseSqlPolicyRoles(raw: string): readonly string[] | null {
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return ["public"];
  for (const part of parts) {
    if (part !== "public" && !isPgIdent(part)) return null;
  }
  return parts;
}

/**
 * `CREATE POLICY` from a validated spec.
 *
 * @param spec - Policy fields
 */
export function buildCreatePolicySql(spec: SqlPolicySpec): string {
  const roles =
    spec.roles.length === 0
      ? "public"
      : spec.roles.map((role) => (role === "public" ? "public" : quotePgIdent(role))).join(", ");
  let text = `CREATE POLICY ${quotePgIdent(spec.name)} ON ${quotePgIdent(spec.table)} AS ${spec.behavior} FOR ${spec.command} TO ${roles}`;
  if (spec.using !== undefined && spec.using.trim() !== "") {
    text += ` USING (${spec.using.trim()})`;
  }
  if (spec.withCheck !== undefined && spec.withCheck.trim() !== "") {
    text += ` WITH CHECK (${spec.withCheck.trim()})`;
  }
  return text;
}

/**
 * `DROP POLICY` for a named policy on a table.
 *
 * @param name - Policy name
 * @param table - Table name
 */
export function buildDropPolicySql(name: string, table: string): string {
  return `DROP POLICY IF EXISTS ${quotePgIdent(name)} ON ${quotePgIdent(table)}`;
}

/**
 * `ALTER POLICY` for roles / USING / WITH CHECK.
 * Command and `AS` require DROP + CREATE.
 *
 * @param spec - Policy identity plus at least one clause
 */
export function buildAlterPolicySql(spec: SqlPolicyAlterSpec): string {
  if (!isPgPolicyName(spec.name)) throw new Error(`invalid policy name "${spec.name}"`);
  if (!isPgIdent(spec.table)) throw new Error(`invalid table name "${spec.table}"`);
  const parts: string[] = [
    `ALTER POLICY ${quotePgIdent(spec.name)} ON ${quotePgIdent(spec.table)}`,
  ];
  if (spec.roles !== undefined) {
    const roles =
      spec.roles.length === 0
        ? "public"
        : spec.roles.map((role) => (role === "public" ? "public" : quotePgIdent(role))).join(", ");
    parts.push(`TO ${roles}`);
  }
  if (spec.using !== undefined && spec.using.trim() !== "") {
    if (!isSafePolicyExpr(spec.using)) throw new Error("invalid USING expression");
    parts.push(`USING (${spec.using.trim()})`);
  }
  if (spec.withCheck !== undefined && spec.withCheck.trim() !== "") {
    if (!isSafePolicyExpr(spec.withCheck)) throw new Error("invalid WITH CHECK expression");
    parts.push(`WITH CHECK (${spec.withCheck.trim()})`);
  }
  if (parts.length === 1) throw new Error("policy alter needs TO, USING, or WITH CHECK");
  return parts.join(" ");
}

/**
 * Enable or disable RLS on a table.
 *
 * @param table - Table name
 * @param enabled - Desired state
 */
export function buildRowSecuritySql(table: string, enabled: boolean): string {
  const verb = enabled ? "ENABLE" : "DISABLE";
  return `ALTER TABLE ${quotePgIdent(table)} ${verb} ROW LEVEL SECURITY`;
}

/**
 * Validate a spec and return it, or throw.
 *
 * @param raw - Untrusted patch fields
 */
export function parseSqlPolicySpec(raw: Readonly<Record<string, unknown>>): SqlPolicySpec {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const table = typeof raw.table === "string" ? raw.table.trim() : "";
  if (!isPgPolicyName(name)) throw new Error(`invalid policy name "${name}"`);
  if (!isPgIdent(table)) throw new Error(`invalid table name "${table}"`);
  const command = parseSqlPolicyCommand(raw.command) ?? "SELECT";
  const behavior = parseSqlPolicyBehavior(raw.behavior ?? raw.permissive) ?? "PERMISSIVE";
  const rolesRaw = typeof raw.roles === "string" ? raw.roles : "public";
  const roles = parseSqlPolicyRoles(rolesRaw);
  if (!roles) throw new Error("invalid policy roles");
  const using = typeof raw.using === "string" ? raw.using.trim() : "";
  const withCheckRaw = raw.withCheck ?? raw.with_check;
  const withCheck = typeof withCheckRaw === "string" ? withCheckRaw.trim() : "";
  if (using !== "" && !isSafePolicyExpr(using)) throw new Error("invalid USING expression");
  if (withCheck !== "" && !isSafePolicyExpr(withCheck)) {
    throw new Error("invalid WITH CHECK expression");
  }
  if (using === "" && withCheck === "") {
    throw new Error("policy needs USING or WITH CHECK");
  }
  return {
    name,
    table,
    command,
    behavior,
    roles,
    ...(using !== "" ? { using } : {}),
    ...(withCheck !== "" ? { withCheck } : {}),
  };
}

/** Row id for a policy in the Console catalog (`table:name`). */
export function sqlPolicyRowId(table: string, name: string): string {
  return `${table}:${name}`;
}

/**
 * Split a catalog row id into table + policy name.
 *
 * @param id - `table:name`
 */
export function parseSqlPolicyRowId(id: string): { readonly table: string; readonly name: string } {
  const cut = id.indexOf(":");
  if (cut <= 0 || cut === id.length - 1) {
    throw new Error(`invalid policy id "${id}"`);
  }
  return { table: id.slice(0, cut), name: id.slice(cut + 1) };
}
