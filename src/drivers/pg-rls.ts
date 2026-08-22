/**
 * Postgres row-level security — identifiers, `CREATE POLICY` SQL,
 * Drizzle emit, and Gate identity helpers (`oke.gate` / `oke.user` / `oke.has_scope`).
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

/** Drizzle / Postgres `TO` targets that must not be quoted. */
const SPECIAL_POLICY_ROLES = new Set(["public", "current_role", "current_user", "session_user"]);

/** Drivers that honor `SET LOCAL row_security` + `oke.*` GUCs. */
export const RLS_CONTEXT_DRIVERS = new Set<string>(["postgres", "pglite"]);

/**
 * Non-superuser role the stamp `SET LOCAL ROLE`s into so RLS applies.
 * Table owners and PGlite's `postgres` superuser otherwise bypass policies.
 */
export const OKE_RLS_ROLE = "oke_app";

/** Live Gate principal stamped onto a SQL statement. */
export type RlsIdentity = {
  readonly gate: string;
  readonly userId: string;
  readonly scopes: readonly string[];
  /**
   * When set, the prelude stamps `oke.tenant` (fourth GUC).
   * Omit entirely when tenancy is off so the prelude stays three params.
   */
  readonly tenantId?: string;
};

/**
 * One statement at a time — Bun.SQL `unsafe` / PGlite `query` reject
 * multi-command batches. Safe to run repeatedly.
 */
export const OKE_RLS_HELPER_STATEMENTS: readonly string[] = [
  "CREATE SCHEMA IF NOT EXISTS oke",
  // DB user is often `oke` — default search_path `"$user", public` then
  // creates unqualified tables in schema `oke`. Domain tables belong in public.
  "SET search_path TO public, oke",
  `DO $oke_search_path$
BEGIN
  EXECUTE 'ALTER ROLE CURRENT_USER SET search_path TO public, oke';
EXCEPTION
  WHEN others THEN NULL;
END
$oke_search_path$`,
  `DO $oke_rehome$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'oke' AND c.relkind = 'r'
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = 'public' AND c2.relname = r.name AND c2.relkind = 'r'
    ) THEN
      EXECUTE format('ALTER TABLE oke.%I SET SCHEMA public', r.name);
    END IF;
  END LOOP;
END
$oke_rehome$`,
  `CREATE OR REPLACE FUNCTION oke.gate() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT current_setting('oke.gate', true) $$`,
  `CREATE OR REPLACE FUNCTION oke.user() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT current_setting('oke.user', true) $$`,
  `CREATE OR REPLACE FUNCTION oke.has_scope(p_scope text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN current_setting('oke.scopes', true) IN ('') THEN false
    ELSE jsonb_exists(current_setting('oke.scopes', true)::jsonb, p_scope)
  END
$$`,
  `CREATE OR REPLACE FUNCTION oke.tenant() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT current_setting('oke.tenant', true) $$`,
  `DO $oke_rls_role$
BEGIN
  CREATE ROLE ${OKE_RLS_ROLE} NOSUPERUSER NOBYPASSRLS NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$oke_rls_role$`,
  `GRANT USAGE ON SCHEMA public TO ${OKE_RLS_ROLE}`,
  `GRANT USAGE ON SCHEMA oke TO ${OKE_RLS_ROLE}`,
  `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA oke TO ${OKE_RLS_ROLE}`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${OKE_RLS_ROLE}`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${OKE_RLS_ROLE}`,
  `GRANT ${OKE_RLS_ROLE} TO CURRENT_USER`,
  `DO $oke_app_search_path$
BEGIN
  EXECUTE 'ALTER ROLE ${OKE_RLS_ROLE} SET search_path TO public, oke';
EXCEPTION
  WHEN others THEN NULL;
END
$oke_app_search_path$`,
];

/**
 * All {@link OKE_RLS_HELPER_STATEMENTS} as one script (PGlite `exec` / `oke db push`).
 */
export const OKE_RLS_HELPER_SQL = `${OKE_RLS_HELPER_STATEMENTS.join(";\n")};`;

/**
 * Install `oke.*` helpers one statement at a time.
 *
 * @param exec - Statement runner
 */
export async function installOkeRlsHelpers(exec: (sql: string) => Promise<unknown>): Promise<void> {
  for (const stmt of OKE_RLS_HELPER_STATEMENTS) {
    await exec(stmt);
  }
}

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
    if (!isPolicyRoleName(part)) return null;
  }
  return parts;
}

/**
 * True when `name` is `public`, a Drizzle special role, or a simple identifier.
 *
 * @param name - Role token
 */
export function isPolicyRoleName(name: string): boolean {
  return SPECIAL_POLICY_ROLES.has(name.toLowerCase()) || isPgIdent(name);
}

/**
 * Format a `TO` role — special names stay unquoted.
 *
 * @param role - Role token
 */
export function formatPolicyRole(role: string): string {
  return SPECIAL_POLICY_ROLES.has(role.toLowerCase()) ? role.toLowerCase() : quotePgIdent(role);
}

/**
 * JSON text stored in `oke.scopes` (sorted unique).
 *
 * @param scopes - Scope strings
 */
export function rlsScopesJson(scopes: readonly string[]): string {
  return JSON.stringify([...new Set(scopes)].sort());
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
      : spec.roles.map((role) => formatPolicyRole(role)).join(", ");
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
        : spec.roles.map((role) => formatPolicyRole(role)).join(", ");
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
  const command = parseSqlPolicyCommand(raw.command) ?? parseSqlPolicyCommand(raw.for) ?? "SELECT";
  const behavior = parseSqlPolicyBehavior(raw.behavior ?? raw.permissive ?? raw.as) ?? "PERMISSIVE";
  const rolesRaw = rolesField(raw.roles ?? raw.to);
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

function rolesField(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw.filter((part): part is string => typeof part === "string").join(", ");
  }
  return "public";
}

/**
 * Drizzle `pgPolicy(...)` source for emit / Console copy-as-code.
 *
 * @param spec - Validated policy
 */
export function emitPgPolicySource(spec: SqlPolicySpec): string {
  const to =
    spec.roles.length === 1
      ? JSON.stringify(formatEmitRole(spec.roles[0]!))
      : `[${spec.roles.map((role) => JSON.stringify(formatEmitRole(role))).join(", ")}]`;
  const lines = [
    `pgPolicy(${JSON.stringify(spec.name)}, {`,
    `  as: ${JSON.stringify(spec.behavior.toLowerCase())},`,
    `  to: ${to},`,
    `  for: ${JSON.stringify(spec.command.toLowerCase())},`,
  ];
  if (spec.using !== undefined && spec.using.trim() !== "") {
    lines.push(`  using: sql\`${escapeSqlTemplate(spec.using.trim())}\`,`);
  }
  if (spec.withCheck !== undefined && spec.withCheck.trim() !== "") {
    lines.push(`  withCheck: sql\`${escapeSqlTemplate(spec.withCheck.trim())}\`,`);
  }
  lines.push(`})`);
  return lines.join("\n");
}

/**
 * `store.schema.policy(...)` source for Console copy-as-code.
 *
 * @param spec - Validated policy
 */
export function emitStoreSchemaPolicySource(spec: SqlPolicySpec): string {
  const to =
    spec.roles.length === 1
      ? JSON.stringify(formatEmitRole(spec.roles[0]!))
      : `[${spec.roles.map((role) => JSON.stringify(formatEmitRole(role))).join(", ")}]`;
  const lines = [
    `store.schema.policy(${JSON.stringify(spec.name)}, {`,
    `  as: ${JSON.stringify(spec.behavior.toLowerCase())},`,
    `  to: ${to},`,
    `  for: ${JSON.stringify(spec.command.toLowerCase())},`,
  ];
  if (spec.using !== undefined && spec.using.trim() !== "") {
    lines.push(`  using: ${JSON.stringify(spec.using.trim())},`);
  }
  if (spec.withCheck !== undefined && spec.withCheck.trim() !== "") {
    lines.push(`  withCheck: ${JSON.stringify(spec.withCheck.trim())},`);
  }
  lines.push(`})`);
  return lines.join("\n");
}

function formatEmitRole(role: string): string {
  return SPECIAL_POLICY_ROLES.has(role.toLowerCase()) ? role.toLowerCase() : role;
}

function escapeSqlTemplate(expr: string): string {
  return expr.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
}

/** One statement in the RLS identity prelude (never a multi-command batch). */
export type RlsPreludeStatement = {
  readonly sql: string;
  readonly params?: readonly string[];
};

/**
 * Per-statement identity frame (no user SQL, no `BEGIN`).
 *
 * The caller pins these to one backend connection via `SqlConnection.transaction`.
 * PGlite's `query` path is prepared statements and rejects `BEGIN; SET; SELECT`
 * as one script.
 *
 * @param identity - Gate principal
 */
export function buildRlsIdentityPreludeSql(identity: RlsIdentity): readonly RlsPreludeStatement[] {
  const configs = [
    "set_config('oke.gate', ?, true)",
    "set_config('oke.user', ?, true)",
    "set_config('oke.scopes', ?, true)",
  ];
  const params: string[] = [identity.gate, identity.userId, rlsScopesJson(identity.scopes)];
  if (identity.tenantId !== undefined) {
    configs.push("set_config('oke.tenant', ?, true)");
    params.push(identity.tenantId);
  }
  return [
    { sql: `SET LOCAL ROLE ${OKE_RLS_ROLE}` },
    { sql: "SET LOCAL row_security = on" },
    {
      sql: `SELECT ${configs.join(", ")}`,
      params,
    },
  ];
}
