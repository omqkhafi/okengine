/**
 * SQL catalog projection for Console Store — indexes, functions, triggers,
 * extensions, RLS policies.
 */

import type { Manifest } from "../../manifest/types.ts";
import type { ResourceRef } from "../../shared/resources.ts";
import type { SqlStoreHandle } from "../../elements/store/sql-session.ts";
import {
  isPgExtensionName,
  isPgExtensionVersion,
  PG_AVAILABLE_EXTENSIONS,
  PG_DEFAULT_ENABLED_EXTENSIONS,
  PG_MEMORY_STALE_VERSIONS,
  pgExtensionSource,
  pgExtensionTitle,
  pgExtensionUrl,
  pgExtensionVersionNewer,
  quotePgExtensionName,
} from "../../drivers/pg-extensions.ts";
import {
  buildAlterPolicySql,
  buildCreatePolicySql,
  buildDropPolicySql,
  buildRowSecuritySql,
  isPgIdent,
  parseSqlPolicyBehavior,
  parseSqlPolicyCommand,
  parseSqlPolicyRoles,
  parseSqlPolicyRowId,
  parseSqlPolicySpec,
  quotePgIdent,
  sqlPolicyRowId,
} from "../../drivers/pg-rls.ts";
import type { ConsoleStoreChild, ConsoleWillNotFire } from "./store.ts";

/** Catalog folder under a SQL store. */
export type SqlCatalogKind = "index" | "function" | "trigger" | "extension" | "policy";

/** Reserved child names used as `storeQuery` targets. */
export const SQL_CATALOG_CHILDREN = [
  { name: "indexes", kind: "index", label: "Indexes" },
  { name: "functions", kind: "function", label: "Functions" },
  { name: "triggers", kind: "trigger", label: "Triggers" },
  { name: "extensions", kind: "extension", label: "Extensions" },
  { name: "policies", kind: "policy", label: "RLS Policies" },
] as const;

const EMPTY_FIRE: ConsoleWillNotFire = {
  writerFlowIds: [],
  signals: [],
  channels: [],
};

/**
 * Catalog kind for a SQL child name, or null when it is a table.
 *
 * @param name - Store-list child name
 */
export function sqlCatalogKind(name: string): SqlCatalogKind | null {
  const normalized = name.startsWith("__") ? name.slice(2) : name;
  const hit = SQL_CATALOG_CHILDREN.find((row) => row.name === normalized);
  return hit?.kind ?? null;
}

/**
 * Indexes / Functions / Extensions / RLS Policies rows under a SQL store.
 *
 * @param storeRef - e.g. `sql:db`
 */
export function sqlCatalogStoreChildren(storeRef: ResourceRef): ConsoleStoreChild[] {
  return SQL_CATALOG_CHILDREN.map((row) => {
    const effectRef = `${storeRef}/${row.name}` as ResourceRef;
    return {
      name: row.name,
      effectRef,
      kind: row.kind,
      writers: [],
      readers: [],
      cache: {
        producedByRead: `computed:${effectRef}`,
        invalidatedByWrites: [],
        invalidatingFlowIds: [],
      },
      willNotFire: EMPTY_FIRE,
      piiColumns: [],
      columnDescriptions: catalogColumnDescriptions(row.kind),
    };
  });
}

/**
 * Live RLS flags (`pg_class.relrowsecurity`) keyed by table name.
 *
 * @param sql - Open SQL handle
 */
export async function listSqlTableRls(sql: SqlStoreHandle): Promise<ReadonlyMap<string, boolean>> {
  const texts = [
    `SELECT c.relname AS name, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')`,
    `SELECT relname AS name, relrowsecurity AS rls FROM pg_class`,
  ];
  for (const text of texts) {
    try {
      const rows = await sql.raw(text);
      const out = new Map<string, boolean>();
      for (const row of rows) {
        const name = stringOrNull(row.name);
        const rls = asCatalogBool(row.rls);
        if (name !== null && rls !== null) out.set(name, rls);
      }
      return out;
    } catch {
      /* memory SQL has no JOIN / pg_namespace — try the flat catalog */
    }
  }
  return new Map();
}

/**
 * Copy RLS flags onto SQL table children. Catalog folders are unchanged.
 *
 * @param children - Store list children
 * @param rlsByTable - Table name → RLS enabled
 */
export function applySqlTableRls(
  children: readonly ConsoleStoreChild[],
  rlsByTable: ReadonlyMap<string, boolean>,
): ConsoleStoreChild[] {
  return children.map((child) => {
    if (child.kind !== "table") return child;
    return { ...child, rls: rlsByTable.get(child.name) ?? child.rls === true };
  });
}

function asCatalogBool(value: unknown): boolean | null {
  if (value === true || value === "t" || value === "true") return true;
  if (value === false || value === "f" || value === "false") return false;
  return null;
}

/**
 * Live catalog when the engine has `pg_*` views; otherwise Manifest-derived
 * indexes (PK / unique), empty functions, and the common extension catalog.
 *
 * @param sql - Open SQL handle
 * @param kind - Catalog folder
 * @param manifest - Manifest (fallback indexes)
 * @param storeName - Manifest store key
 * @param limit - Max rows
 */
export async function listSqlCatalog(
  sql: SqlStoreHandle,
  kind: SqlCatalogKind,
  manifest: Manifest | null,
  storeName: string,
  limit: number,
): Promise<readonly Record<string, unknown>[]> {
  const live = await tryLiveCatalog(sql, kind, limit);
  if (live) return live;
  if (kind === "index") return manifestIndexes(manifest, storeName).slice(0, limit);
  if (kind === "extension") return fallbackExtensions().slice(0, limit);
  return [];
}

/**
 * Create a row-level security policy (`CREATE POLICY`).
 *
 * @param sql - Open SQL handle
 * @param patch - Policy fields
 */
export async function createSqlPolicy(
  sql: SqlStoreHandle,
  patch: Readonly<Record<string, unknown>>,
): Promise<void> {
  const spec = parseSqlPolicySpec(patch);
  if (patch.enableRls === true) {
    await sql.raw(buildRowSecuritySql(spec.table, true));
  }
  await sql.raw(buildCreatePolicySql(spec));
}

/**
 * Drop a row-level security policy.
 *
 * @param sql - Open SQL handle
 * @param id - Catalog row id (`table:name`)
 */
export async function dropSqlPolicy(sql: SqlStoreHandle, id: string): Promise<void> {
  const { table, name } = parseSqlPolicyRowId(id);
  if (!isPgIdent(table) || !name.trim()) {
    throw new Error(`invalid policy id "${id}"`);
  }
  await sql.raw(buildDropPolicySql(name, table));
}

/**
 * Patch an existing policy. `roles` / `using` / `with_check` run
 * `ALTER POLICY`. `command` / `permissive` drop and recreate.
 *
 * @param sql - Open SQL handle
 * @param id - Catalog row id (`table:name`)
 * @param patch - Grid cell updates
 */
export async function alterSqlPolicy(
  sql: SqlStoreHandle,
  id: string,
  patch: Readonly<Record<string, unknown>>,
): Promise<void> {
  const { table, name } = parseSqlPolicyRowId(id);
  if (!isPgIdent(table) || !name.trim()) {
    throw new Error(`invalid policy id "${id}"`);
  }
  const rows = await listSqlCatalog(sql, "policy", null, "", 500);
  const current = rows.find((row) => String(row.id) === id);
  if (!current) throw new Error(`policy "${id}" not found`);

  const nextCommand =
    parseSqlPolicyCommand(patch.command) ?? parseSqlPolicyCommand(current.command);
  const nextBehavior =
    parseSqlPolicyBehavior(patch.permissive ?? patch.behavior) ??
    parseSqlPolicyBehavior(current.permissive);
  const commandChanged =
    nextCommand !== null && nextCommand !== parseSqlPolicyCommand(current.command);
  const behaviorChanged =
    nextBehavior !== null && nextBehavior !== parseSqlPolicyBehavior(current.permissive);

  if (commandChanged || behaviorChanged) {
    const spec = parseSqlPolicySpec({
      name,
      table,
      command: nextCommand ?? current.command,
      behavior: nextBehavior ?? current.permissive,
      roles: typeof patch.roles === "string" ? patch.roles : catalogText(current.roles, "public"),
      using: typeof patch.using === "string" ? patch.using : catalogText(current.using, ""),
      withCheck:
        typeof patch.with_check === "string"
          ? patch.with_check
          : typeof patch.withCheck === "string"
            ? patch.withCheck
            : catalogText(current.with_check, ""),
    });
    await sql.raw(buildDropPolicySql(name, table));
    await sql.raw(buildCreatePolicySql(spec));
    return;
  }

  const roles = typeof patch.roles === "string" ? parseSqlPolicyRoles(patch.roles) : undefined;
  if (typeof patch.roles === "string" && !roles) throw new Error("invalid policy roles");
  await sql.raw(
    buildAlterPolicySql({
      name,
      table,
      ...(roles ? { roles } : {}),
      ...(typeof patch.using === "string" ? { using: patch.using } : {}),
      ...(typeof patch.with_check === "string"
        ? { withCheck: patch.with_check }
        : typeof patch.withCheck === "string"
          ? { withCheck: patch.withCheck }
          : {}),
    }),
  );
}

/**
 * Enable or disable RLS on a table.
 *
 * @param sql - Open SQL handle
 * @param table - Table name
 * @param enabled - Desired state
 */
export async function setSqlRowSecurity(
  sql: SqlStoreHandle,
  table: string,
  enabled: boolean,
): Promise<void> {
  if (!isPgIdent(table)) throw new Error(`invalid table name "${table}"`);
  await sql.raw(buildRowSecuritySql(table, enabled));
}

/** Optional `CREATE EXTENSION` clauses. */
export type SqlExtensionCreateOptions = {
  readonly schema?: string;
  readonly version?: string;
  readonly cascade?: boolean;
};

/**
 * Enable or disable a SQL extension (`CREATE` / `DROP EXTENSION`).
 *
 * @param sql - Open SQL handle
 * @param name - Extension name
 * @param enabled - Desired state
 * @param options - Optional SCHEMA / VERSION / CASCADE on create
 */
export async function setSqlExtension(
  sql: SqlStoreHandle,
  name: string,
  enabled: boolean,
  options?: SqlExtensionCreateOptions,
): Promise<void> {
  if (!isPgExtensionName(name)) {
    throw new Error(`invalid extension name "${name}"`);
  }
  const ident = quotePgExtensionName(name);
  if (!enabled) {
    await sql.raw(`DROP EXTENSION IF EXISTS ${ident}`);
    return;
  }
  await sql.raw(buildCreateExtensionSql(name, options));
}

/**
 * `CREATE EXTENSION IF NOT EXISTS` with optional WITH clauses.
 *
 * @param name - Validated extension name
 * @param options - Optional SCHEMA / VERSION / CASCADE
 */
export function buildCreateExtensionSql(name: string, options?: SqlExtensionCreateOptions): string {
  const parts = [`CREATE EXTENSION IF NOT EXISTS ${quotePgExtensionName(name)}`];
  const withParts: string[] = [];
  const schema = options?.schema?.trim() ?? "";
  if (schema !== "") {
    if (!isPgIdent(schema) || schema.toLowerCase() === "pg_catalog") {
      throw new Error(`invalid extension schema "${schema}"`);
    }
    withParts.push(`SCHEMA ${quotePgIdent(schema)}`);
  }
  const version = options?.version?.trim() ?? "";
  if (version !== "") {
    if (!isPgExtensionVersion(version)) {
      throw new Error(`invalid extension version "${version}"`);
    }
    withParts.push(`VERSION '${version}'`);
  }
  if (options?.cascade === true) withParts.push("CASCADE");
  if (withParts.length > 0) parts.push(`WITH ${withParts.join(" ")}`);
  return parts.join(" ");
}

/**
 * Upgrade an installed extension to the engine default, or a specific version.
 *
 * @param sql - Open SQL handle
 * @param name - Extension name
 * @param to - Optional dotted version (`ALTER EXTENSION … UPDATE TO`)
 */
export async function upgradeSqlExtension(
  sql: SqlStoreHandle,
  name: string,
  to?: string,
): Promise<void> {
  if (!isPgExtensionName(name)) {
    throw new Error(`invalid extension name "${name}"`);
  }
  if (to !== undefined && !isPgExtensionVersion(to)) {
    throw new Error(`invalid extension version "${to}"`);
  }
  const ident = quotePgExtensionName(name);
  const text =
    to !== undefined
      ? `ALTER EXTENSION ${ident} UPDATE TO '${to}'`
      : `ALTER EXTENSION ${ident} UPDATE`;
  await sql.raw(text);
}

function catalogColumnDescriptions(kind: SqlCatalogKind): Readonly<Record<string, string>> {
  if (kind === "index") {
    return {
      name: "Index name",
      table: "Table",
      columns: "Key columns",
      unique: "Unique / primary",
      def: "Definition",
    };
  }
  if (kind === "function") {
    return {
      name: "Function",
      schema: "Schema",
      args: "Arguments",
      language: "Language",
    };
  }
  if (kind === "trigger") {
    return {
      name: "Trigger",
      table: "Table",
      function: "Function",
      enabled: "Enabled",
    };
  }
  if (kind === "policy") {
    return {
      name: "Policy",
      table: "Table",
      command: "Command",
      roles: "Roles",
      permissive: "Permissive or restrictive",
      using: "USING expression",
      with_check: "WITH CHECK expression",
    };
  }
  return {
    title: "Name",
    name: "Key",
    version: "Version",
    comment: "Description",
    source: "Built-in or library",
    enabled: "Installed",
    available: "Newest version on the engine",
    upgrade: "Newer version available",
    url: "Project or docs page",
  };
}

async function tryLiveCatalog(
  sql: SqlStoreHandle,
  kind: SqlCatalogKind,
  limit: number,
): Promise<readonly Record<string, unknown>[] | null> {
  const text = liveCatalogSql(kind, limit);
  try {
    const rows = await sql.raw(text);
    if (kind === "extension") return rows.map((row) => projectExtensionRow(row));
    if (kind === "policy") {
      return rows.filter(isAppCatalogSchema).map((row) => projectPolicyRow(row));
    }
    if (kind === "trigger") return rows.map((row) => projectTriggerRow(row));
    return rows;
  } catch {
    return null;
  }
}

function liveCatalogSql(kind: SqlCatalogKind, limit: number): string {
  if (kind === "index") {
    return `SELECT indexname AS name, tablename AS "table", indexdef AS def FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY tablename, indexname LIMIT ${limit}`;
  }
  if (kind === "function") {
    return `SELECT p.proname AS name, n.nspname AS schema, pg_get_function_identity_arguments(p.oid) AS args, l.lanname AS language FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1 LIMIT ${limit}`;
  }
  if (kind === "trigger") {
    return `SELECT t.tgname AS name, c.relname AS "table", p.proname AS function, t.tgenabled AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid WHERE NOT t.tgisinternal AND n.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1 LIMIT ${limit}`;
  }
  if (kind === "policy") {
    // Memory SQL has no `NOT IN`. Filter system schemas after the read.
    return `SELECT * FROM pg_policies ORDER BY tablename, policyname LIMIT ${limit}`;
  }
  return `SELECT name, default_version AS version, comment, installed_version FROM pg_available_extensions ORDER BY name LIMIT ${limit}`;
}

const SYSTEM_SCHEMAS = new Set(["pg_catalog", "information_schema"]);

function isAppCatalogSchema(row: Record<string, unknown>): boolean {
  const schema = stringOrNull(row.schema ?? row.schemaname) ?? "public";
  return !SYSTEM_SCHEMAS.has(schema);
}

function projectPolicyRow(row: Record<string, unknown>): Record<string, unknown> {
  const name = stringOrNull(row.name ?? row.policyname) ?? "";
  const table = stringOrNull(row.table ?? row.tablename) ?? "";
  return {
    id: sqlPolicyRowId(table, name),
    name,
    table,
    schema: stringOrNull(row.schema ?? row.schemaname) ?? "public",
    command: stringOrNull(row.command ?? row.cmd) ?? "ALL",
    roles: rolesText(row.roles),
    permissive: stringOrNull(row.permissive) ?? "PERMISSIVE",
    using: stringOrNull(row.using ?? row.qual),
    with_check: stringOrNull(row.with_check),
  };
}

function projectTriggerRow(row: Record<string, unknown>): Record<string, unknown> {
  const enabled = row.enabled;
  return {
    name: stringOrNull(row.name) ?? "",
    table: stringOrNull(row.table) ?? "",
    function: stringOrNull(row.function) ?? "",
    enabled: enabled !== "D" && enabled !== false && enabled !== 0,
  };
}

function rolesText(value: unknown): string {
  if (Array.isArray(value)) return value.map((part) => String(part)).join(", ");
  if (typeof value === "string") {
    return value.replace(/^{|}$/g, "").replaceAll('"', "");
  }
  return "public";
}

function projectExtensionRow(row: Record<string, unknown>): Record<string, unknown> {
  const rawName = row.name;
  const name = typeof rawName === "string" || typeof rawName === "number" ? String(rawName) : "";
  const available = stringOrNull(row.available ?? row.default_version ?? row.version);
  const enabled = extensionInstalled(row.installed_version ?? row.enabled);
  const installed = enabled ? stringOrNull(row.installed_version) : null;
  const stale = PG_MEMORY_STALE_VERSIONS[name];
  const current =
    installed ??
    (stale && available && pgExtensionVersionNewer(available, stale) ? stale : available);
  return {
    title: pgExtensionTitle(name),
    name,
    version: current,
    available,
    upgrade: Boolean(available && current && pgExtensionVersionNewer(available, current)),
    comment: row.comment ?? "",
    source: pgExtensionSource(name),
    enabled,
    url: pgExtensionUrl(name),
  };
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function catalogText(value: unknown, fallback: string): string {
  return stringOrNull(value) ?? fallback;
}

function extensionInstalled(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    return t !== "" && t !== "false" && t !== "0" && t !== "f";
  }
  return value != null && value !== false;
}

/**
 * Common extension catalog when the engine has no `pg_available_extensions`.
 */
export function fallbackExtensions(): Record<string, unknown>[] {
  const on = new Set(PG_DEFAULT_ENABLED_EXTENSIONS);
  return PG_AVAILABLE_EXTENSIONS.map((ext) =>
    projectExtensionRow({
      name: ext.name,
      version: ext.version,
      comment: ext.comment,
      installed_version: on.has(ext.name)
        ? (PG_MEMORY_STALE_VERSIONS[ext.name] ?? ext.version)
        : null,
    }),
  );
}

function manifestIndexes(manifest: Manifest | null, storeName: string): Record<string, unknown>[] {
  const tables = manifest?.stores?.[storeName]?.tables ?? {};
  const out: Record<string, unknown>[] = [];
  for (const [table, spec] of Object.entries(tables)) {
    const columns = spec?.columns ?? {};
    for (const [col, raw] of Object.entries(columns)) {
      if (!raw || typeof raw !== "object") continue;
      const pk = "primaryKey" in raw && raw.primaryKey === true;
      const unique = "unique" in raw && raw.unique === true;
      if (!pk && !unique) continue;
      out.push({
        name: pk ? `${table}_pkey` : `${table}_${col}_key`,
        table,
        columns: col,
        unique: true,
        def: pk ? `PRIMARY KEY (${col})` : `UNIQUE (${col})`,
      });
    }
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
