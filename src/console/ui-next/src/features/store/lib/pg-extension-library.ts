/**
 * Console view of the Postgres extension library (external packs).
 */

import {
  isPgExtensionVersion,
  PG_EXTENSION_CATEGORY_LABELS,
  PG_LIBRARY_EXTENSIONS,
  pgExtensionTitle,
  pgExtensionUrl,
  quotePgExtensionName,
  type PgExtensionCategory,
  type PgExtensionInfo,
} from "../../../../../../drivers/pg-extensions.ts";
import { isPgIdent, quotePgIdent } from "../../../../../../drivers/pg-rls.ts";

export { PG_EXTENSION_CATEGORY_LABELS, PG_LIBRARY_EXTENSIONS, pgExtensionTitle, pgExtensionUrl };
export type { PgExtensionCategory, PgExtensionInfo };

/** Human title for a library pack (same as {@link pgExtensionTitle}). */
export const libraryExtensionTitle = pgExtensionTitle;

/** Featured marketplace cards (Timescale / Cron / PostGIS). */
export const PG_FEATURED_LIBRARY_NAMES = ["timescaledb", "pg_cron", "postgis"] as const;

/** Human titles for featured cards. */
export const PG_FEATURED_LIBRARY_TITLES: Record<
  (typeof PG_FEATURED_LIBRARY_NAMES)[number],
  string
> = {
  timescaledb: "Timescale",
  pg_cron: "Cron",
  postgis: "PostGIS",
};

const LIBRARY_VENDORS: Record<string, string> = {
  timescaledb: "Timescale",
  timescaledb_toolkit: "Timescale",
  vectorscale: "Timescale",
  topn: "Timescale",
  pg_cron: "Citus Data",
  citus: "Microsoft",
  citus_columnar: "Microsoft",
  postgis: "PostGIS Project",
  postgis_topology: "PostGIS Project",
  postgis_raster: "PostGIS Project",
  postgis_sfcgal: "PostGIS Project",
  postgis_tiger_geocoder: "PostGIS Project",
  pgrouting: "pgRouting",
  pg_search: "ParadeDB",
  pgmq: "pgmq",
  pg_net: "Supabase",
  index_advisor: "Supabase",
  wrappers: "Supabase",
  pg_graphql: "Supabase",
  age: "Apache",
  datasketches: "Apache",
  pg_duckdb: "DuckDB",
  duckdb_fdw: "DuckDB",
  anon: "PostgreSQL Anonymizer",
  pg_stat_monitor: "Percona",
};

/**
 * Vendor line for a library card (`Built by …`), when known.
 *
 * @param name - Extension name
 */
export function libraryExtensionVendor(name: string): string | undefined {
  return LIBRARY_VENDORS[name];
}

/**
 * Featured packs still in `rows`, in showcase order.
 *
 * @param rows - Library rows (usually the full catalog)
 */
export function featuredLibraryExtensions(
  rows: readonly PgExtensionInfo[],
): readonly PgExtensionInfo[] {
  const byName = new Map(rows.map((ext) => [ext.name, ext]));
  return PG_FEATURED_LIBRARY_NAMES.flatMap((name) => {
    const ext = byName.get(name);
    return ext ? [ext] : [];
  });
}

/** Category order in the library sheet. */
export const PG_LIBRARY_CATEGORY_ORDER: readonly PgExtensionCategory[] = [
  "time",
  "jobs",
  "geo",
  "search",
  "graph",
  "scale",
  "security",
  "http",
  "fdw",
  "lang",
  "analytics",
];

/**
 * Library entries not already on the current catalog page.
 *
 * @param presentNames - Names already listed in Extensions
 */
export function availableLibraryExtensions(
  presentNames: readonly string[],
): readonly PgExtensionInfo[] {
  const have = new Set(presentNames);
  return PG_LIBRARY_EXTENSIONS.filter((ext) => !have.has(ext.name));
}

/**
 * Search haystack for one library row (name, comment, category, tags, requires).
 *
 * @param ext - Library row
 */
export function libraryExtensionHaystack(ext: PgExtensionInfo): string {
  return [
    ext.name,
    libraryExtensionTitle(ext.name),
    ext.comment,
    ext.category,
    PG_EXTENSION_CATEGORY_LABELS[ext.category],
    ...(ext.tags ?? []),
    ...(ext.requires ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Filter library rows by whitespace-separated tokens (all must match).
 *
 * @param rows - Library rows
 * @param query - Free-text search
 */
export function searchLibraryExtensions(
  rows: readonly PgExtensionInfo[],
  query: string,
): readonly PgExtensionInfo[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return rows;
  return rows.filter((ext) => {
    const hay = libraryExtensionHaystack(ext);
    return tokens.every((token) => hay.includes(token));
  });
}

/**
 * Group library rows by category, omitting empty groups.
 *
 * @param rows - Library rows
 */
export function groupLibraryExtensions(rows: readonly PgExtensionInfo[]): readonly {
  readonly category: PgExtensionCategory;
  readonly label: string;
  readonly items: readonly PgExtensionInfo[];
}[] {
  return PG_LIBRARY_CATEGORY_ORDER.flatMap((category) => {
    const items = rows.filter((row) => row.category === category);
    if (items.length === 0) return [];
    return [{ category, label: PG_EXTENSION_CATEGORY_LABELS[category], items }];
  });
}

/** One extension the install review will run. */
export interface ExtensionInstallItem {
  readonly name: string;
  readonly title: string;
  readonly already: boolean;
}

/** Review payload for the install sheet (Supabase-style). */
export interface ExtensionInstallPlan {
  readonly items: readonly ExtensionInstallItem[];
  readonly sql: string;
  readonly note?: string;
}

const INSTALL_NOTES: Record<string, string> = {
  pg_cron: "After install, schedule jobs with cron.schedule(). HTTP job types need pg_net.",
  timescaledb: "After install, convert time-series tables with create_hypertable().",
  timescaledb_toolkit: "Hyperfunctions on top of Timescale — needs timescaledb first.",
  postgis: "Adds geometry / geography types and spatial indexes.",
  pg_net: "Lets SQL send async HTTP. Required for webhook-style cron jobs.",
  pgmq: "Lightweight queue tables in Postgres. Pair with pg_cron to drain jobs.",
  pg_graphql: "Exposes a GraphQL schema from your tables.",
};

/** Optional `CREATE EXTENSION` Advanced knobs. */
export type ExtensionInstallOptions = {
  readonly schema?: string;
  readonly version?: string;
  readonly cascade?: boolean;
};

/**
 * `CREATE EXTENSION` line the Console will run for one name.
 *
 * @param name - Extension key
 * @param options - Optional SCHEMA / VERSION / CASCADE
 */
export function extensionInstallSql(name: string, options?: ExtensionInstallOptions): string {
  const parts = [`CREATE EXTENSION IF NOT EXISTS ${quotePgExtensionName(name)}`];
  const withParts: string[] = [];
  const schema = options?.schema?.trim() ?? "";
  if (schema !== "" && isSafeExtensionSchema(schema)) {
    withParts.push(`SCHEMA ${quotePgIdent(schema)}`);
  }
  const version = options?.version?.trim() ?? "";
  if (version !== "" && isPgExtensionVersion(version)) {
    withParts.push(`VERSION '${version}'`);
  }
  if (options?.cascade === true) withParts.push("CASCADE");
  if (withParts.length > 0) parts.push(`WITH ${withParts.join(" ")}`);
  return `${parts.join(" ")};`;
}

/**
 * True when `schema` is a creatable target (not `pg_catalog`).
 *
 * @param schema - Schema name
 */
export function isSafeExtensionSchema(schema: string): boolean {
  const t = schema.trim();
  return isPgIdent(t) && t.toLowerCase() !== "pg_catalog";
}

/**
 * Count of Advanced extension knobs that are set.
 *
 * @param options - Install options
 */
export function extensionInstallAdvancedCount(options: ExtensionInstallOptions): number {
  return (
    (options.schema?.trim() ? 1 : 0) +
    (options.version?.trim() ? 1 : 0) +
    (options.cascade === true ? 1 : 0)
  );
}

/**
 * What an Install click will enable: requires first, then the pack.
 *
 * @param ext - Pack being installed
 * @param installed - Names already on the catalog
 */
export function extensionInstallPlan(
  ext: PgExtensionInfo,
  installed: ReadonlySet<string>,
  options?: ExtensionInstallOptions,
): ExtensionInstallPlan {
  const names = [...(ext.requires ?? []), ext.name];
  const items = names.map((name) => ({
    name,
    title: libraryExtensionTitle(name),
    already: installed.has(name),
  }));
  const pending = items.filter((item) => !item.already);
  const sql =
    pending.length > 0
      ? pending
          .map((item) =>
            extensionInstallSql(item.name, item.name === ext.name ? options : undefined),
          )
          .join("\n")
      : `-- ${ext.name} is already installed`;
  const note = INSTALL_NOTES[ext.name];
  return { items, sql, ...(note ? { note } : {}) };
}
