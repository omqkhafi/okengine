/**
 * TypeScript surface matching `manifest.v1.schema.json`.
 *
 * Kept hand-aligned with the schema (the public, runtime-neutral contract).
 * Within major version `1.x`, only additive schema changes are allowed.
 */

/** Manifest schema version — independent of the okengine runtime package. */
export type ManifestOkeVersion = "1.0";

/** Store facet identifiers. */
export type StoreFacet = "sql" | "kv" | "files" | "index";

/** Signal delivery physics — mandatory, no default. */
export type SignalDelivery = "once" | "broadcast" | "live";

/** Flow plane — user (application) vs operator (Console). */
export type FlowPlane = "user" | "operator";

/** Deployable topology axis. */
export type Topology = "monolith" | "services";

/** Tenancy isolation strength. */
export type TenancyIsolation = "row" | "schema" | "database";

/** Plugin supply-chain origin. */
export type PluginOrigin = "core" | "local" | "community";

/** Rate-limit strategies. */
export type RateStrategy =
  | "sliding-window-counter"
  | "fixed-window"
  | "sliding-log"
  | "token-bucket"
  | "leaky-bucket";

/** Channel medium. */
export type ChannelMedium = "email" | "sms" | "whatsapp" | "push" | "any";

/** Resource ref: `sql:table`, `kv:namespace`, `files:bucket`, `index:name`. */
export type ResourceRef = `${StoreFacet}:${string}`;

/**
 * Observability read capability for `fx.runs` — not a store facet.
 * Declare on `effects.reads` (never `writes`).
 */
export type RunsResourceRef = "runs";

/**
 * Auth key-management capability for `fx.auth` list/create/revoke/rotate/update.
 * Not a store facet — do not declare `sql:oke_api_keys`.
 */
export type AuthApiKeysResourceRef = "auth:api-keys";

/**
 * Auth tenant-management capability for `fx.auth` list/switch/create/….
 * Not a store facet — do not declare `sql:oke_tenants`.
 */
export type AuthTenantsResourceRef = "auth:tenants";

/**
 * Dead-letter / live-stream read capability — not a store facet.
 * Declare on `effects.reads` (never `writes`).
 */
export type SignalResourceRef = `signal:${string}`;

/** Signal name reference. */
export type SignalRef = string;

/** Channel template name reference. */
export type TemplateRef = string;

/** Prompt name, optionally `name@version`. */
export type PromptRef = string;

/** Vault secret name reference. */
export type SecretRef = string;

/** Flow id reference. */
export type FlowRef = string;

/**
 * Embedded JSON Schema document, or an opaque string ref from extraction.
 */
export type JsonSchema = string | Record<string, unknown>;

/**
 * Load-bearing effect surface inferred from `fx` usage.
 *
 * `secrets` is a capability (not an irreversible effect).
 * `calls` portals to the callee's transitive effects.
 * `sends` / `asks` are irreversible (asks also nondeterministic + cost).
 */
export interface Effects {
  /** Store reads, plus `"runs"` for `fx.runs` and `signal:name` for `fx.deadLetters` / `fx.live`. */
  reads?: Array<
    | ResourceRef
    | RunsResourceRef
    | SignalResourceRef
    | AuthApiKeysResourceRef
    | AuthTenantsResourceRef
  >;
  /** Store writes, plus `"auth:api-keys"` / `"auth:tenants"` for `fx.auth` mutations. */
  writes?: Array<ResourceRef | AuthApiKeysResourceRef | AuthTenantsResourceRef>;
  /** Emitted signals. */
  emits?: SignalRef[];
  /** Channel template sends (irreversible). */
  sends?: TemplateRef[];
  /** AI prompt asks (irreversible, nondeterministic, cost). */
  asks?: PromptRef[];
  /** Vault secret capabilities. */
  secrets?: SecretRef[];
  /** Nested flow calls (transitive effects). */
  calls?: FlowRef[];
}

/** HTTP trigger surface. */
export interface HttpTrigger {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "QUERY";
  path: string;
}

/** Change-data-capture trigger. */
export interface CdcTrigger {
  table: string;
  column?: string;
  store?: string;
}

/**
 * MCP tool exposure — explicit per-flow opt-in for OAuth user-plane tools.
 * Presence of this trigger means the flow is listed over MCP; absence means
 * it is not an MCP tool (deny-by-default).
 */
export interface McpTrigger {
  name: string;
}

/**
 * Discriminated trigger. Omitting trigger means call-only (internal) flow.
 */
export interface Trigger {
  http?: HttpTrigger;
  signal?: string;
  cron?: string;
  every?: string;
  cdc?: CdcTrigger;
  mcp?: McpTrigger;
}

/** Declared service-level objective. */
export interface Slo {
  availability?: string;
  latency?: Record<string, string>;
}

/** Deprecation marker. */
export type Deprecated =
  | boolean
  | string
  | {
      since?: string;
      replaceWith?: string;
      message?: string;
    };

/** Per-flow AI/cost estimate. */
export interface FlowCost {
  estimatePerCall?: number;
  budget?: number;
}

/** Typed error map or list of error names. */
export type FlowErrors = string[] | Record<string, JsonSchema>;

/** One Flow in the manifest. */
export interface Flow {
  trigger?: Trigger;
  gates?: string[];
  in?: JsonSchema;
  out?: JsonSchema;
  errors?: FlowErrors;
  effects?: Effects;
  source?: string;
  plane?: FlowPlane;
  durable?: boolean;
  /** Live signal name when this flow streams `delivery: "live"` SSE. */
  live?: string;
  cache?: boolean | string;
  cacheKeys?: string;
  slo?: Slo;
  deprecated?: Deprecated;
  steps?: string[];
  nondeterministic?: boolean;
  cost?: FlowCost;
  pii?: "masked" | "allow" | "denied";
  /**
   * Explicit acknowledgement that PII may reach a third-party model.
   * Alias of `pii: "allow"` for AI egress governance.
   */
  allowPii?: boolean;
  /** Author acknowledges an intentional contract break. */
  breaking?: boolean;
  /**
   * When `false`, skip tenant-role scope union.
   * Default `true` when `gate.auth.tenant` is on.
   */
  tenantScoped?: boolean;
}

/** Live-tape cap. Omit both fields (or omit `retention`) for an unbounded tape. */
export interface SignalRetention {
  /** Drop events older than this duration (`"7d"`, `"1h"`, `"30s"`, …). */
  maxAge?: string;
  /** Keep only the newest N live events. */
  maxCount?: number;
}

/** One Signal declaration. */
export interface Signal {
  delivery: SignalDelivery;
  /** Optional human description (falls back to the signal map key). */
  description?: string;
  retries?: number;
  deadLetter?: boolean;
  schema?: JsonSchema;
  optional?: boolean;
  /** Live-tape cap (`delivery: "live"` only). Omitted = unbounded. */
  retention?: SignalRetention;
}

/** Column / field classification for privacy and retention. */
export interface ColumnClassification {
  pii?: boolean;
  sensitive?: boolean;
  retain?: string;
}

/**
 * Declared SQL column (abstract schema) — additive over {@link ColumnClassification}.
 * Manifest `tables.*.columns` may be a bare classification or a full declaration.
 */
/** Foreign-key target recorded on a {@link DeclaredColumn}. */
export interface DeclaredColumnReference {
  /** Referenced table export / SQL name when known. */
  table?: string;
  /** Referenced column key when known. */
  column?: string;
}

export interface DeclaredColumn extends ColumnClassification {
  /** SQL type primitive — full `field.*` surface (`text` · `integer` · `jsonb` · …). */
  type?:
    | "text"
    | "varchar"
    | "char"
    | "boolean"
    | "smallint"
    | "integer"
    | "bigint"
    | "serial"
    | "smallserial"
    | "bigserial"
    | "numeric"
    | "real"
    | "doublePrecision"
    | "json"
    | "jsonb"
    | "uuid"
    | "time"
    | "timestamp"
    | "date"
    | "interval"
    | "point"
    | "line"
    | "bytea"
    | "inet"
    | "cidr"
    | "macaddr"
    | "macaddr8";
  /** When false, column is NOT NULL. */
  nullable?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  /** Literal default when present. */
  default?: string | number | boolean | null;
  /** Allowed string values for enum columns (`text`/`varchar`/`char`). */
  enumValues?: string[];
  /** Per-type options (`length`, `precision`, `scale`, `withTimezone`, `mode`, `fields`). */
  length?: number;
  precision?: number;
  scale?: number;
  withTimezone?: boolean;
  mode?: string;
  fields?: string;
  /** Database column name (snake_case by default). */
  sqlName?: string;
  /** Optional human description (falls back to the column map key). */
  description?: string;
  /** Foreign key when `.references()` was declared. */
  references?: DeclaredColumnReference;
}

/** Field classification value forms. */
export type ClassificationValue = string | string[] | ColumnClassification;

/** Declared Postgres RLS policy on a {@link Table}. */
export interface TablePolicy {
  as?: "permissive" | "restrictive";
  to?: string | string[];
  for?: "all" | "select" | "insert" | "update" | "delete";
  using?: string;
  withCheck?: string;
}

/** SQL table metadata. */
export interface Table {
  columns?: Record<string, DeclaredColumn | ColumnClassification>;
  classifications?: Record<string, ClassificationValue>;
  /** RLS enabled (`pgTable.withRLS` or any policy). */
  rls?: boolean;
  /** Policy name → Drizzle-shaped spec. */
  policies?: Record<string, TablePolicy>;
  /** When `false`, skip fail-loud tenant-policy requirement. */
  tenantScoped?: boolean;
}

/** One Store declaration. */
export interface Store {
  facet: StoreFacet;
  /** Optional human description (falls back to the store map key). */
  description?: string;
  tables?: Record<string, Table>;
  namespaces?: string[];
  buckets?: string[];
  indexes?: string[];
  classifications?: Record<string, ClassificationValue>;
  /**
   * KV only — namespace persists in SQL (`oke_kv`), not the cache Redis.
   * Distinct from Flow `durable` (journaled steps).
   */
  durable?: boolean;
  /**
   * KV only — prefix keys with `{tenantId}:` when tenancy is on.
   * Default `true` then; `false` is the global-namespace opt-out.
   */
  tenantScoped?: boolean;
}

/** Named clock / schedule. */
export interface Clock {
  cron?: string;
  every?: string;
  timezone?: string;
  overridable?: boolean;
  /** Optional human description (falls back to the clock map key). */
  description?: string;
  /** Expand one `oke_crons` row per tenant. */
  perTenant?: boolean;
}

/** Named gate — policy, rate, or a flattened `gate.all` handle. */
export interface Gate {
  kind?: "policy" | "rate" | "all";
  policy?: string;
  strategy?: RateStrategy;
  max?: number;
  per?: string;
  keyBy?: string;
  scopes?: string[];
  roles?: string[];
  /** Member gate ids when {@link kind} is `"all"`. */
  members?: string[];
  /** Optional human description (falls back to the gate map key). */
  description?: string;
}

/** Vault secret / config contract (never a secret value). */
export interface SecretContract {
  description?: string;
  /**
   * Rotation cadence (`"90d"`) or `"never"`. Omit is the same as `"never"`.
   */
  rotate?: string;
  schema?: JsonSchema;
  /**
   * When `false`, the value is non-sensitive config — Console may show it
   * in the clear. Defaults to `true` (secret).
   */
  sensitive?: boolean;
  /**
   * Resolve per `fx.tenant.id` at request time (not boot).
   * Default `true` when `gate.auth.tenant` is on.
   */
  perTenant?: boolean;
}

/** Channel template. */
export interface Channel {
  /** Optional human description (falls back to the channel map key). */
  description?: string;
  medium?: ChannelMedium;
  locales?: string[];
  schema?: JsonSchema;
  from?: string;
}

/** AI model binding. */
export interface AiModel {
  provider?: string;
  tier?: string;
  model?: string;
  /** Protocol driver override for this logical binding. */
  driverId?: string;
}

/** Prompt / agent budget. */
export interface AiBudget {
  maxCostPerCall?: number;
  maxCostPerRun?: number;
}

/** Versioned prompt artifact. */
export interface AiPrompt {
  version?: number;
  evals?: string;
  budget?: AiBudget;
  /** Ordered recovery chain of logical model names. */
  via?: string[];
  /** Per-command deadline (`"30s"` or milliseconds). */
  timeout?: string | number;
  model?: string;
  in?: JsonSchema;
  out?: JsonSchema;
}

/** Bounded agent whose tools are flows. */
export interface AiAgent {
  tools?: FlowRef[];
  maxSteps?: number;
  model?: string;
  budget?: AiBudget;
}

/**
 * External MCP server the app consumes — tools join the existing `fx.call`
 * / `toolLoop` path as `mcp:<server>/<tool>` capability refs.
 */
export interface AiMcpServer {
  /** Streamable HTTP endpoint. */
  url?: string;
  /** stdio executable (no shell string). */
  command?: string;
  /** Arguments for {@link command}. */
  args?: string[];
  /** Bearer secret contract name (never the value). */
  auth?: SecretRef;
  /** Required allowlist — never trust whatever `tools/list` exposes. */
  tools: string[];
}

/** AI element catalogue. */
export interface Ai {
  models?: Record<string, AiModel>;
  prompts?: Record<string, AiPrompt>;
  agents?: Record<string, AiAgent>;
  mcpServers?: Record<string, AiMcpServer>;
}

/** Per-table metadata on a Manifest {@link Plugin}. */
export interface PluginTable {
  plane?: string;
  /** Optional human description (falls back to the table name). */
  description?: string;
}

/** Plugin capability declaration. */
export interface Plugin {
  origin?: PluginOrigin;
  version?: string;
  declares?: string[];
  intercepts?: string[];
  /** Declared `.needs()` dependencies (plugin names or element/driver ids). */
  needs?: string[];
  /** Optional metadata for `table:*` contributions. */
  tables?: Record<string, PluginTable>;
}

/** Tenancy configuration (resolver is code; isolation is data). */
export interface Tenancy {
  /** `gate.auth.tenant` is on. */
  enabled?: boolean;
  isolation?: TenancyIsolation;
  /** Pure B2B — every user-plane request needs a tenant. */
  membershipRequired?: boolean;
}

/** i18n configuration. */
export interface I18n {
  locales?: string[];
  default?: string;
  dir?: Record<string, "ltr" | "rtl">;
}

/** Cross-flow journey with composed SLO. */
export interface Journey {
  slo?: Slo;
  composes?: string;
  flows?: FlowRef[];
}

/**
 * The Manifest — the 100-year artifact.
 *
 * Everything else (client, docs, Console, capabilities, infra) derives from this.
 */
export interface Manifest {
  oke: ManifestOkeVersion;
  app: string;
  flows?: Record<string, Flow>;
  signals?: Record<string, Signal>;
  stores?: Record<string, Store>;
  clocks?: Record<string, Clock>;
  gates?: Record<string, Gate>;
  vault?: Record<string, SecretContract>;
  channels?: Record<string, Channel>;
  ai?: Ai;
  plugins?: Record<string, Plugin>;
  drivers?: Record<string, string[]>;
  tenancy?: Tenancy;
  i18n?: I18n;
  journeys?: Record<string, Journey>;
  topology?: Topology;
  images?: Record<string, string>;
}

/** Four blast-radius categories from Console §9.12. */
export type DiffCategory =
  | "contract-breaking"
  | "permission-widening"
  | "effect-widening"
  | "no-impact";

/** How a path changed. */
export type DiffKind = "added" | "removed" | "changed";

/** One classified behavioural change between two manifests. */
export interface ManifestChange {
  path: string;
  category: DiffCategory;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
  summary: string;
}

/** Result of {@link diffManifest}. */
export interface ManifestDiffResult {
  changes: ManifestChange[];
  /** Highest blast-radius category present, or `null` when empty. */
  severity: DiffCategory | null;
}
