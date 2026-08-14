/**
 * Postgres extension catalogs — built-in contrib vs external library.
 * Live engines use `pg_available_extensions`; memory starts with built-in only.
 */

/** Where an extension comes from. */
export type PgExtensionSource = "builtin" | "library";

/** Library grouping for the Console add sheet. */
export type PgExtensionCategory =
  | "language"
  | "contrib"
  | "time"
  | "geo"
  | "jobs"
  | "search"
  | "graph"
  | "scale"
  | "security"
  | "http"
  | "fdw"
  | "lang"
  | "analytics";

/** One available extension. */
export type PgExtensionInfo = {
  readonly name: string;
  readonly version: string;
  readonly comment: string;
  readonly source: PgExtensionSource;
  readonly category: PgExtensionCategory;
  /** Extra search tokens (aliases, vendors, use-cases). */
  readonly tags?: readonly string[];
  /** Other extensions this pack expects. */
  readonly requires?: readonly string[];
};

/**
 * Contrib + language extensions bundled with stock Postgres (plus `vector`).
 * `plpgsql` is enabled by default.
 */
export const PG_BUILTIN_EXTENSIONS: readonly PgExtensionInfo[] = [
  {
    name: "plpgsql",
    version: "1.0",
    comment: "PL/pgSQL procedural language",
    source: "builtin",
    category: "language",
  },
  {
    name: "pgcrypto",
    version: "1.3",
    comment: "Cryptographic functions",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "uuid-ossp",
    version: "1.1",
    comment: "UUID generation (OSSP)",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "citext",
    version: "1.6",
    comment: "Case-insensitive text",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "hstore",
    version: "1.8",
    comment: "Key-value store in a column",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "pg_trgm",
    version: "1.6",
    comment: "Trigram text similarity",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "btree_gin",
    version: "1.3",
    comment: "GIN support for common types",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "btree_gist",
    version: "1.7",
    comment: "GiST support for common types",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "unaccent",
    version: "1.1",
    comment: "Text search dictionary that removes accents",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "ltree",
    version: "1.3",
    comment: "Hierarchical tree-like data type",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "cube",
    version: "1.5",
    comment: "Multidimensional cubes",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "earthdistance",
    version: "1.2",
    comment: "Great-circle distances on Earth",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "fuzzystrmatch",
    version: "1.2",
    comment: "Fuzzy string matching",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "intarray",
    version: "1.5",
    comment: "Functions for 1-D arrays of integers",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "isn",
    version: "1.2",
    comment: "International product numbering types",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "lo",
    version: "1.1",
    comment: "Large Object maintenance",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "tablefunc",
    version: "1.0",
    comment: "Crosstab and table functions",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "tcn",
    version: "1.0",
    comment: "Triggered change notifications",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "tsm_system_rows",
    version: "1.0",
    comment: "TABLESAMPLE method SYSTEM_ROWS",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "tsm_system_time",
    version: "1.0",
    comment: "TABLESAMPLE method SYSTEM_TIME",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "xml2",
    version: "1.1",
    comment: "XPath querying and XSLT",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "postgres_fdw",
    version: "1.1",
    comment: "Foreign-data wrapper for PostgreSQL",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "file_fdw",
    version: "1.0",
    comment: "Foreign-data wrapper for files",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "dblink",
    version: "1.2",
    comment: "Connect to other PostgreSQL databases",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "amcheck",
    version: "1.4",
    comment: "Verify relation integrity",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "bloom",
    version: "1.0",
    comment: "Bloom-filter index access method",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "dict_int",
    version: "1.0",
    comment: "Text search dictionary for integers",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "dict_xsyn",
    version: "1.0",
    comment: "Text search dictionary for extended synonym",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "pageinspect",
    version: "1.12",
    comment: "Inspect contents of database pages",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "pg_buffercache",
    version: "1.5",
    comment: "Examine shared buffer cache",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "pg_freespacemap",
    version: "1.2",
    comment: "Examine the free space map",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "pg_prewarm",
    version: "1.2",
    comment: "Prewarm relation data",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "pg_stat_statements",
    version: "1.11",
    comment: "Track planning and execution statistics",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "pg_surgery",
    version: "1.0",
    comment: "Low-level heap surgery",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "pg_visibility",
    version: "1.2",
    comment: "Examine visibility map",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "pgrowlocks",
    version: "1.2",
    comment: "Show row-level locking information",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "pgstattuple",
    version: "1.5",
    comment: "Tuple-level statistics",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "sslinfo",
    version: "1.2",
    comment: "Information about SSL certificates",
    source: "builtin",
    category: "contrib",
  },
  {
    name: "vector",
    version: "0.8.6",
    comment: "Vector similarity search (pgvector)",
    source: "builtin",
    category: "search",
  },
];

function lib(
  name: string,
  version: string,
  comment: string,
  category: PgExtensionCategory,
  tags: readonly string[],
  requires?: readonly string[],
): PgExtensionInfo {
  return {
    name,
    version,
    comment,
    source: "library",
    category,
    tags,
    ...(requires && requires.length > 0 ? { requires } : {}),
  };
}

/**
 * External extensions the Console library can add (Timescale, PostGIS, …).
 * Not on the memory catalog until added; live engines still need the package.
 */
export const PG_LIBRARY_EXTENSIONS: readonly PgExtensionInfo[] = [
  lib(
    "timescaledb",
    "2.17.0",
    "Time-series hypertables, compression, and continuous aggregates",
    "time",
    ["timescale", "hypertable", "iot", "metrics"],
  ),
  lib(
    "timescaledb_toolkit",
    "1.19.0",
    "Timescale hyperfunctions — locf, gapfill, stats",
    "time",
    ["timescale", "hyperfunctions", "analytics"],
    ["timescaledb"],
  ),
  lib("pg_partman", "5.2.0", "Partition maintenance for time- and serial-based tables", "time", [
    "partition",
    "retention",
  ]),
  lib("pg_ivm", "1.9", "Incremental view maintenance for materialized views", "time", [
    "materialized",
    "ivm",
    "refresh",
  ]),
  lib("temporal_tables", "1.2.2", "System-period temporal tables (SQL:2011 style)", "time", [
    "history",
    "versioning",
    "audit",
  ]),
  lib("pg_cron", "1.6", "Cron-based job scheduler inside the database", "jobs", [
    "cron",
    "schedule",
    "jobs",
  ]),
  lib("pg_later", "0.3.0", "Fire-and-forget SQL jobs after the current transaction", "jobs", [
    "async",
    "queue",
    "later",
  ]),
  lib("pg_background", "1.2", "Run commands in a background worker", "jobs", [
    "worker",
    "background",
  ]),
  lib("postgis", "3.5.0", "Geographic objects and spatial indexes", "geo", [
    "gis",
    "geo",
    "geometry",
    "geography",
    "spatial",
  ]),
  lib(
    "postgis_topology",
    "3.5.0",
    "PostGIS topology types and functions",
    "geo",
    ["gis", "topology"],
    ["postgis"],
  ),
  lib(
    "postgis_raster",
    "3.5.0",
    "PostGIS raster types and functions",
    "geo",
    ["gis", "raster", "coverage"],
    ["postgis"],
  ),
  lib(
    "postgis_sfcgal",
    "3.5.0",
    "3D / solid geometry via SFCGAL",
    "geo",
    ["gis", "3d", "sfcgal"],
    ["postgis"],
  ),
  lib("address_standardizer", "3.5.0", "Parse and normalize street addresses", "geo", [
    "gis",
    "geocode",
    "address",
  ]),
  lib(
    "postgis_tiger_geocoder",
    "3.5.0",
    "TIGER geocoder for US addresses",
    "geo",
    ["gis", "geocode", "tiger"],
    ["postgis", "address_standardizer"],
  ),
  lib(
    "pgrouting",
    "3.7.0",
    "Routing algorithms on PostGIS networks",
    "geo",
    ["gis", "routing", "shortest-path"],
    ["postgis"],
  ),
  lib("h3", "4.1.0", "Uber H3 hexagonal hierarchical spatial index", "geo", ["gis", "hex", "uber"]),
  lib(
    "mobilitydb",
    "1.2.0",
    "Temporal and spatiotemporal types for moving objects",
    "geo",
    ["gis", "trajectory", "temporal"],
    ["postgis"],
  ),
  lib("pointcloud", "1.2.5", "LIDAR / point-cloud storage (PDAL)", "geo", ["gis", "lidar", "pdal"]),
  lib("rum", "1.3", "GIN-like access method for faster full-text search", "search", [
    "fts",
    "full-text",
    "gin",
  ]),
  lib("pg_search", "0.15.0", "ParadeDB BM25 full-text search", "search", [
    "paradedb",
    "bm25",
    "fts",
  ]),
  lib("pgroonga", "3.2.5", "Groonga full-text search (CJK-friendly)", "search", [
    "fts",
    "cjk",
    "japanese",
  ]),
  lib("pg_bigm", "1.2", "Bigram full-text search (LIKE acceleration)", "search", [
    "fts",
    "bigram",
    "like",
  ]),
  lib("zhparser", "2.2", "Chinese text search parser", "search", ["fts", "chinese", "cjk"]),
  lib("zombodb", "3000.2.7", "Elasticsearch-backed indexes from Postgres", "search", [
    "elasticsearch",
    "fts",
  ]),
  lib("vchord", "0.4.3", "VectorChord — disk-based vector index", "search", [
    "vector",
    "embedding",
    "ann",
  ]),
  lib("vectorscale", "0.7.1", "Timescale vector index (StreamingDiskANN)", "search", [
    "vector",
    "timescale",
    "ann",
  ]),
  lib("age", "1.5.0", "Apache AGE graph queries (openCypher)", "graph", [
    "graph",
    "cypher",
    "opencypher",
  ]),
  lib("citus", "12.1", "Distributed Postgres — shard and scale out", "scale", [
    "shard",
    "distributed",
    "microsoft",
  ]),
  lib(
    "citus_columnar",
    "12.1",
    "Citus columnar storage for analytics",
    "scale",
    ["columnar", "olap", "citus"],
    ["citus"],
  ),
  lib("pg_repack", "1.5.1", "Online table bloat cleanup without exclusive locks", "scale", [
    "bloat",
    "vacuum",
    "reindex",
  ]),
  lib("pg_squeeze", "1.8", "Automatic bloat cleanup as a background worker", "scale", [
    "bloat",
    "vacuum",
  ]),
  lib("hypopg", "1.4.1", "Hypothetical indexes for EXPLAIN without creating them", "scale", [
    "explain",
    "index",
    "what-if",
  ]),
  lib("pg_hint_plan", "1.7.0", "Planner hints in SQL comments", "scale", [
    "planner",
    "hint",
    "explain",
  ]),
  lib("pg_stat_kcache", "2.3.0", "Filesystem and CPU stats per query", "scale", [
    "stats",
    "observability",
  ]),
  lib("pg_qualstats", "2.1.1", "Predicate statistics for missing-index hints", "scale", [
    "stats",
    "index",
  ]),
  lib("pg_wait_sampling", "1.1.6", "Sample wait events for lock analysis", "scale", [
    "waits",
    "locks",
    "observability",
  ]),
  lib("pg_stat_monitor", "2.1.0", "Percona query-performance monitor", "scale", [
    "stats",
    "percona",
    "observability",
  ]),
  lib("pgaudit", "17.0", "Session and object audit logging", "security", [
    "audit",
    "compliance",
    "logging",
  ]),
  lib("pgsodium", "3.1.9", "Libsodium cryptography helpers", "security", [
    "crypto",
    "encryption",
    "libsodium",
  ]),
  lib("pgjwt", "0.2.0", "Create and verify JSON Web Tokens in SQL", "security", [
    "jwt",
    "auth",
    "token",
  ]),
  lib("anon", "2.1.0", "PostgreSQL Anonymizer — masking and dumping", "security", [
    "pii",
    "mask",
    "gdpr",
    "anonymizer",
  ]),
  lib("credcheck", "2.8", "Password complexity and reuse checks", "security", ["password", "auth"]),
  lib("set_user", "4.1.0", "Privilege bridging with audit trail", "security", [
    "sudo",
    "privilege",
    "audit",
  ]),
  lib("pg_tle", "1.5.0", "Trusted Language Extensions (AWS)", "security", [
    "tle",
    "aws",
    "sandbox",
  ]),
  lib("pg_net", "0.14.0", "Async HTTP from SQL (Supabase)", "http", [
    "http",
    "webhook",
    "supabase",
  ]),
  lib("http", "1.6", "Synchronous HTTP client from SQL", "http", ["http", "rest", "curl"]),
  lib("wrappers", "0.4.5", "Supabase FDW framework (Stripe, Firebase, S3…)", "http", [
    "fdw",
    "supabase",
    "stripe",
  ]),
  lib("pg_graphql", "1.5.11", "GraphQL API generated from the schema", "http", [
    "graphql",
    "api",
    "supabase",
  ]),
  lib("pgmq", "1.5.1", "Lightweight message queue in Postgres", "http", ["queue", "mq", "jobs"]),
  lib("pg_jsonschema", "0.3.3", "Validate JSON against JSON Schema", "http", [
    "json",
    "schema",
    "validate",
  ]),
  lib("mysql_fdw", "1.2", "Foreign-data wrapper for MySQL / MariaDB", "fdw", [
    "mysql",
    "mariadb",
    "fdw",
  ]),
  lib("mongo_fdw", "5.5.2", "Foreign-data wrapper for MongoDB", "fdw", ["mongodb", "fdw"]),
  lib("tds_fdw", "2.0.4", "Foreign-data wrapper for SQL Server / Sybase", "fdw", [
    "mssql",
    "sqlserver",
    "fdw",
  ]),
  lib("oracle_fdw", "2.7.0", "Foreign-data wrapper for Oracle", "fdw", ["oracle", "fdw"]),
  lib("sqlite_fdw", "2.5.0", "Foreign-data wrapper for SQLite", "fdw", ["sqlite", "fdw"]),
  lib("redis_fdw", "1.0", "Foreign-data wrapper for Redis", "fdw", ["redis", "fdw"]),
  lib("duckdb_fdw", "1.1.0", "Foreign-data wrapper for DuckDB", "fdw", ["duckdb", "olap", "fdw"]),
  lib("pg_duckdb", "0.3.0", "DuckDB engine inside Postgres", "fdw", [
    "duckdb",
    "olap",
    "analytics",
  ]),
  lib("ogr_fdw", "1.1.5", "GDAL/OGR spatial foreign tables", "fdw", [
    "gis",
    "gdal",
    "shapefile",
    "fdw",
  ]),
  lib("plpython3u", "1.0", "Untrusted Python 3 procedural language", "lang", ["python", "pl"]),
  lib("plperl", "1.0", "Perl procedural language", "lang", ["perl", "pl"]),
  lib("pltcl", "1.0", "Tcl procedural language", "lang", ["tcl", "pl"]),
  lib("plv8", "3.2.3", "JavaScript (V8) procedural language", "lang", ["javascript", "v8", "pl"]),
  lib("plrust", "1.2.8", "Trusted Rust procedural language", "lang", ["rust", "pl"]),
  lib("plpgsql_check", "2.7.15", "Static analysis for PL/pgSQL functions", "lang", [
    "lint",
    "plpgsql",
  ]),
  lib("hll", "2.18", "HyperLogLog distinct-count sketches", "analytics", [
    "cardinality",
    "sketch",
    "approx",
  ]),
  lib("tdigest", "1.4.2", "t-digest quantiles and percentiles", "analytics", [
    "quantile",
    "percentile",
    "sketch",
  ]),
  lib("topn", "2.7.0", "Approximate most-frequent values", "analytics", [
    "topk",
    "sketch",
    "timescale",
  ]),
  lib("datasketches", "1.7.0", "Apache DataSketches — HLL, Theta, KLL", "analytics", [
    "sketch",
    "apache",
    "approx",
  ]),
  lib("pg_uuidv7", "1.6.0", "UUIDv7 generators (time-ordered)", "analytics", ["uuid", "id"]),
  lib("pg_idkit", "0.2.4", "UUID, ULID, KSUID, TypeID generators", "analytics", [
    "uuid",
    "ulid",
    "ksuid",
  ]),
  lib("pg_hashids", "1.3.0", "YouTube-style hashids from integers", "analytics", [
    "hashid",
    "shortid",
  ]),
];

/** Built-in catalog — memory / fallback default. */
export const PG_AVAILABLE_EXTENSIONS: readonly PgExtensionInfo[] = PG_BUILTIN_EXTENSIONS;

/** Built-in + library — names the Console may add or enable. */
export const PG_ALL_EXTENSIONS: readonly PgExtensionInfo[] = [
  ...PG_BUILTIN_EXTENSIONS,
  ...PG_LIBRARY_EXTENSIONS,
];

/** Extensions enabled on a fresh memory / fallback catalog. */
export const PG_DEFAULT_ENABLED_EXTENSIONS: readonly string[] = ["plpgsql"];

/**
 * Memory first-enable pins these at an older version so Upgrade is visible.
 * Live engines use `installed_version` vs `default_version`.
 */
export const PG_MEMORY_STALE_VERSIONS: Readonly<Record<string, string>> = {
  pgcrypto: "1.2",
  amcheck: "1.3",
  btree_gin: "1.2",
  pg_stat_statements: "1.10",
  pg_trgm: "1.5",
  vector: "0.8.0",
};

/**
 * True when `available` is a newer dotted version than `installed`.
 *
 * @param available - Engine default version
 * @param installed - Currently installed version
 */
export function pgExtensionVersionNewer(available: string, installed: string): boolean {
  if (available === installed) return false;
  const a = available.split(".").map((part) => Number(part));
  const b = installed.split(".").map((part) => Number(part));
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const iv = b[i] ?? 0;
    if (!Number.isFinite(av) || !Number.isFinite(iv)) return available !== installed;
    if (av > iv) return true;
    if (av < iv) return false;
  }
  return false;
}

/**
 * True when `version` is a dotted numeric extension version.
 *
 * @param version - Candidate version
 */
export function isPgExtensionVersion(version: string): boolean {
  return /^[0-9]+(\.[0-9]+)*$/.test(version);
}

const PG_EXTENSION_TITLES: Record<string, string> = {
  plpgsql: "PL/pgSQL",
  pgcrypto: "Crypto",
  "uuid-ossp": "UUID OSSP",
  citext: "CIText",
  hstore: "Hstore",
  pg_trgm: "Trigram",
  btree_gin: "B-tree GIN",
  btree_gist: "B-tree GiST",
  unaccent: "Unaccent",
  ltree: "Ltree",
  cube: "Cube",
  earthdistance: "Earth Distance",
  fuzzystrmatch: "Fuzzy Match",
  intarray: "Intarray",
  isn: "ISN",
  lo: "Large Objects",
  tablefunc: "Tablefunc",
  tcn: "TCN",
  tsm_system_rows: "System Rows",
  tsm_system_time: "System Time",
  xml2: "XML2",
  postgres_fdw: "Postgres FDW",
  file_fdw: "File FDW",
  dblink: "DB Link",
  amcheck: "AM Check",
  bloom: "Bloom",
  dict_int: "Dict Int",
  dict_xsyn: "Dict Xsyn",
  pageinspect: "Page Inspect",
  pg_buffercache: "Buffer Cache",
  pg_freespacemap: "Free Space Map",
  pg_prewarm: "Prewarm",
  pg_stat_statements: "Stat Statements",
  pg_surgery: "Surgery",
  pg_visibility: "Visibility",
  pgrowlocks: "Row Locks",
  pgstattuple: "Stat Tuple",
  sslinfo: "SSL Info",
  vector: "pgvector",
  timescaledb: "Timescale",
  timescaledb_toolkit: "Timescale Toolkit",
  pg_partman: "Partman",
  pg_ivm: "IVM",
  temporal_tables: "Temporal Tables",
  pg_cron: "Cron",
  pg_later: "Later",
  pg_background: "Background",
  postgis: "PostGIS",
  postgis_topology: "PostGIS Topology",
  postgis_raster: "PostGIS Raster",
  postgis_sfcgal: "PostGIS SFCGAL",
  address_standardizer: "Address Standardizer",
  postgis_tiger_geocoder: "PostGIS Tiger Geocoder",
  pgrouting: "pgRouting",
  h3: "H3",
  mobilitydb: "MobilityDB",
  pointcloud: "Pointcloud",
  rum: "RUM",
  pg_search: "ParadeDB Search",
  pgroonga: "PGroonga",
  pg_bigm: "Bigm",
  zhparser: "Zhparser",
  zombodb: "ZomboDB",
  vchord: "VectorChord",
  vectorscale: "Vectorscale",
  age: "Apache AGE",
  citus: "Citus",
  citus_columnar: "Citus Columnar",
  pg_repack: "Repack",
  pg_squeeze: "Squeeze",
  hypopg: "HypoPG",
  pg_hint_plan: "Hint Plan",
  pg_stat_kcache: "Stat Kcache",
  pg_qualstats: "Qualstats",
  pg_wait_sampling: "Wait Sampling",
  pg_stat_monitor: "Stat Monitor",
  pgaudit: "pgAudit",
  pgsodium: "Sodium",
  pgjwt: "JWT",
  anon: "Anonymizer",
  credcheck: "Credcheck",
  set_user: "Set User",
  pg_tle: "TLE",
  pg_net: "Net",
  http: "HTTP",
  wrappers: "Wrappers",
  pg_graphql: "GraphQL",
  pgmq: "Queues",
  pg_jsonschema: "JSON Schema",
  mysql_fdw: "MySQL FDW",
  mongo_fdw: "MongoDB FDW",
  tds_fdw: "TDS FDW",
  oracle_fdw: "Oracle FDW",
  sqlite_fdw: "SQLite FDW",
  redis_fdw: "Redis FDW",
  duckdb_fdw: "DuckDB FDW",
  pg_duckdb: "DuckDB",
  ogr_fdw: "OGR FDW",
  plpython3u: "PL/Python 3",
  plperl: "PL/Perl",
  pltcl: "PL/Tcl",
  plv8: "PL/V8",
  plrust: "PL/Rust",
  plpgsql_check: "PL/pgSQL Check",
  hll: "HyperLogLog",
  tdigest: "t-digest",
  topn: "TopN",
  datasketches: "DataSketches",
  pg_uuidv7: "UUIDv7",
  pg_idkit: "IDkit",
  pg_hashids: "Hashids",
};

const PG_EXTENSION_TITLE_TOKENS: Record<string, string> = {
  fdw: "FDW",
  jwt: "JWT",
  http: "HTTP",
  ivm: "IVM",
  tle: "TLE",
  hll: "HLL",
  age: "AGE",
  rum: "RUM",
  h3: "H3",
  postgis: "PostGIS",
  duckdb: "DuckDB",
  gin: "GIN",
  gist: "GiST",
};

/**
 * Human title for a catalog or library extension.
 *
 * @param name - Extension key (`timescaledb_toolkit`, `amcheck`)
 */
export function pgExtensionTitle(name: string): string {
  const mapped = PG_EXTENSION_TITLES[name];
  if (mapped) return mapped;
  const stripped = name.replace(/^pg_/, "");
  return stripped
    .split(/[_-]+/)
    .filter((part) => part.length > 0)
    .map((part) => PG_EXTENSION_TITLE_TOKENS[part] ?? part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const PG_DOCS = "https://www.postgresql.org/docs/current";

/** Postgres contrib / language doc slugs (`pg_trgm` → `pgtrgm.html`). */
const PG_CONTRIB_DOC_SLUGS: Readonly<Record<string, string>> = {
  plpgsql: "plpgsql",
  pgcrypto: "pgcrypto",
  "uuid-ossp": "uuid-ossp",
  citext: "citext",
  hstore: "hstore",
  pg_trgm: "pgtrgm",
  btree_gin: "btree-gin",
  btree_gist: "btree-gist",
  unaccent: "unaccent",
  ltree: "ltree",
  cube: "cube",
  earthdistance: "earthdistance",
  fuzzystrmatch: "fuzzystrmatch",
  intarray: "intarray",
  isn: "isn",
  lo: "lo",
  tablefunc: "tablefunc",
  tcn: "tcn",
  tsm_system_rows: "tsm-system-rows",
  tsm_system_time: "tsm-system-time",
  xml2: "xml2",
  postgres_fdw: "postgres-fdw",
  file_fdw: "file-fdw",
  dblink: "dblink",
  amcheck: "amcheck",
  bloom: "bloom",
  dict_int: "dict-int",
  dict_xsyn: "dict-xsyn",
  pageinspect: "pageinspect",
  pg_buffercache: "pgbuffercache",
  pg_freespacemap: "pgfreespacemap",
  pg_prewarm: "pgprewarm",
  pg_stat_statements: "pgstatstatements",
  pg_surgery: "pgsurgery",
  pg_visibility: "pgvisibility",
  pgrowlocks: "pgrowlocks",
  pgstattuple: "pgstattuple",
  sslinfo: "sslinfo",
  plpython3u: "plpython",
  plperl: "plperl",
  pltcl: "pltcl",
};

/** Project pages for non-contrib packs (`vector` → pgvector). */
const PG_EXTENSION_URLS: Readonly<Record<string, string>> = {
  vector: "https://github.com/pgvector/pgvector",
  timescaledb: "https://github.com/timescale/timescaledb",
  timescaledb_toolkit: "https://github.com/timescale/timescaledb-toolkit",
  pg_partman: "https://github.com/pgpartman/pg_partman",
  pg_ivm: "https://github.com/sraoss/pg_ivm",
  temporal_tables: "https://github.com/arkhipov/temporal_tables",
  pg_cron: "https://github.com/citusdata/pg_cron",
  pg_later: "https://github.com/supabase/pg_later",
  pg_background: "https://github.com/vibhorkum/pg_background",
  postgis: "https://postgis.net",
  postgis_topology: "https://postgis.net/docs/Topology.html",
  postgis_raster: "https://postgis.net/docs/RT_reference.html",
  postgis_sfcgal: "https://postgis.net/docs/reference.html#reference_sfcgal",
  address_standardizer: "https://postgis.net/docs/manual-dev/Address_Standardizer.html",
  postgis_tiger_geocoder: "https://postgis.net/docs/Extras.html#Tiger_Geocoder",
  pgrouting: "https://pgrouting.org",
  h3: "https://github.com/zachasme/h3-pg",
  mobilitydb: "https://github.com/MobilityDB/MobilityDB",
  pointcloud: "https://github.com/pgpointcloud/pointcloud",
  rum: "https://github.com/postgrespro/rum",
  pg_search: "https://github.com/paradedb/paradedb",
  pgroonga: "https://pgroonga.github.io",
  pg_bigm: "https://github.com/pgbigm/pg_bigm",
  zhparser: "https://github.com/amutu/zhparser",
  zombodb: "https://github.com/zombodb/zombodb",
  vchord: "https://github.com/tensorchord/VectorChord",
  vectorscale: "https://github.com/timescale/pgvectorscale",
  age: "https://age.apache.org",
  citus: "https://github.com/citusdata/citus",
  citus_columnar: "https://github.com/citusdata/citus",
  pg_repack: "https://github.com/reorg/pg_repack",
  pg_squeeze: "https://github.com/cybertec-postgresql/pg_squeeze",
  hypopg: "https://github.com/HypoPG/hypopg",
  pg_hint_plan: "https://github.com/ossc-db/pg_hint_plan",
  pg_stat_kcache: "https://github.com/powa-team/pg_stat_kcache",
  pg_qualstats: "https://github.com/powa-team/pg_qualstats",
  pg_wait_sampling: "https://github.com/postgrespro/pg_wait_sampling",
  pg_stat_monitor: "https://github.com/percona/pg_stat_monitor",
  pgaudit: "https://github.com/pgaudit/pgaudit",
  pgsodium: "https://github.com/michelp/pgsodium",
  pgjwt: "https://github.com/michelp/pgjwt",
  anon: "https://postgresql-anonymizer.readthedocs.io",
  credcheck: "https://github.com/HexaCluster/credcheck",
  set_user: "https://github.com/pgaudit/set_user",
  pg_tle: "https://github.com/aws/pg_tle",
  pg_net: "https://github.com/supabase/pg_net",
  http: "https://github.com/pramsey/pgsql-http",
  wrappers: "https://github.com/supabase/wrappers",
  pg_graphql: "https://github.com/supabase/pg_graphql",
  pgmq: "https://github.com/pgmq/pgmq",
  pg_jsonschema: "https://github.com/supabase/pg_jsonschema",
  mysql_fdw: "https://github.com/enterprisedb/mysql_fdw",
  mongo_fdw: "https://github.com/enterprisedb/mongo_fdw",
  tds_fdw: "https://github.com/tds-fdw/tds_fdw",
  oracle_fdw: "https://github.com/laurenz/oracle_fdw",
  sqlite_fdw: "https://github.com/pgspider/sqlite_fdw",
  redis_fdw: "https://github.com/pg-redis-fdw/redis_fdw",
  duckdb_fdw: "https://github.com/alitrack/duckdb_fdw",
  pg_duckdb: "https://github.com/duckdb/pg_duckdb",
  ogr_fdw: "https://github.com/pramsey/pgsql-ogr-fdw",
  plv8: "https://github.com/plv8/plv8",
  plrust: "https://github.com/tcdi/plrust",
  plpgsql_check: "https://github.com/okbob/plpgsql_check",
  hll: "https://github.com/citusdata/postgresql-hll",
  tdigest: "https://github.com/tvondra/tdigest",
  topn: "https://github.com/timescale/pg_topn",
  datasketches: "https://github.com/apache/datasketches-postgresql",
  pg_uuidv7: "https://github.com/fboulnois/pg_uuidv7",
  pg_idkit: "https://github.com/gaeljw/pg_idkit",
  pg_hashids: "https://github.com/iCyberon/pg_hashids",
};

/**
 * Homepage for a catalog or library extension, or null when unknown.
 *
 * @param name - Extension key (`vector`, `amcheck`)
 */
export function pgExtensionUrl(name: string): string | null {
  const mapped = PG_EXTENSION_URLS[name];
  if (mapped) return mapped;
  const slug = PG_CONTRIB_DOC_SLUGS[name];
  if (slug) return `${PG_DOCS}/${slug}.html`;
  return null;
}

/** Category labels for the library sheet. */
export const PG_EXTENSION_CATEGORY_LABELS: Record<PgExtensionCategory, string> = {
  language: "Language",
  contrib: "Contrib",
  time: "Time series",
  geo: "Geospatial",
  jobs: "Jobs",
  search: "Search",
  graph: "Graph",
  scale: "Scale",
  security: "Security",
  http: "HTTP",
  fdw: "Foreign data",
  lang: "Languages",
  analytics: "Analytics",
};

/**
 * Look up a built-in or library extension by name.
 *
 * @param name - Extension name
 */
export function findPgExtension(name: string): PgExtensionInfo | undefined {
  return PG_ALL_EXTENSIONS.find((ext) => ext.name === name);
}

/**
 * Catalog source for a name (`library` when listed there, else `builtin`).
 *
 * @param name - Extension name
 */
export function pgExtensionSource(name: string): PgExtensionSource {
  return findPgExtension(name)?.source ?? "builtin";
}

/**
 * True when `name` is a safe extension identifier (`uuid-ossp` allowed).
 *
 * @param name - Extension name
 */
export function isPgExtensionName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(name);
}

/**
 * Quote an extension name for `CREATE` / `DROP EXTENSION`.
 *
 * @param name - Validated extension name
 */
export function quotePgExtensionName(name: string): string {
  return `"${name.replaceAll('"', "")}"`;
}
