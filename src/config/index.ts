/**
 * `oke.config.ts` surface. Subpath: `okengine/config`.
 *
 * Driver maps are protocol-named; vendor/image choice lives in `images`.
 * Three environment targets: `dev` (Docker Compose), `test` (PGLite), `prod`.
 * @module
 */

/**
 * Environment role keys used in driver maps.
 *
 * - `dev` — local development via Docker Compose (`oke dev`)
 * - `test` — automated tests (`oke test` / PGLite)
 * - `prod` — production deploy
 */
import type { VaultElementConfig } from "../elements/vault/types.ts";

export type { VaultElementConfig };

export type ConfigEnv = "dev" | "test" | "prod";

/** Pool options for SQL drivers. */
export interface DriverPoolOptions {
  readonly max?: number;
  readonly min?: number;
}

/**
 * Per-environment driver id (string) or rich `{ driver, url, … }` object.
 * Replica URLs are listed for read-only routing.
 */
export type DriverRef =
  | string
  | {
      readonly driver: string;
      readonly url?: unknown;
      readonly pool?: DriverPoolOptions;
      readonly replicas?: readonly unknown[];
      readonly key?: unknown;
    };

/** Map of env → driver ref (canonical three-key shape). */
export type EnvDriverMap = Partial<Record<ConfigEnv, DriverRef>>;

/** Driver pin: bare ref (all envs) or per-env map (`dev` / `test` / `prod`). */
export type EnvDriverInput = DriverRef | EnvDriverMap;

/** Store facet driver maps. */
export interface StoreDriversConfig {
  readonly sql?: EnvDriverInput;
  readonly kv?: EnvDriverInput;
  readonly files?: EnvDriverInput;
  readonly index?: EnvDriverInput;
}

/** Channel medium → env driver map. */
export interface ChannelDriversConfig {
  readonly email?: EnvDriverInput;
  readonly sms?: EnvDriverInput;
  readonly whatsapp?: EnvDriverInput;
  readonly push?: EnvDriverInput;
}

/** Top-level drivers block in {@link OkeConfig}. */
export interface DriversConfig {
  /**
   * Flat prod protocol list (Manifest `drivers.prod`).
   * Optional — nested maps are preferred for boot binding.
   */
  readonly prod?: readonly string[];
  readonly store?: StoreDriversConfig;
  readonly signal?: EnvDriverInput;
  readonly clock?: EnvDriverInput;
  /** Durable-run journal: `memory` · `file` · `postgres`. */
  readonly journal?: EnvDriverInput;
  readonly vault?: EnvDriverInput;
  readonly channel?: ChannelDriversConfig;
  readonly ai?: EnvDriverInput;
  readonly runs?: EnvDriverInput;
}

/**
 * Container image pins, nested the same way as {@link DriversConfig}:
 * `store.*` / `channel.*` facets nest under their owning element; roles with
 * no driver counterpart (`vault` picks a driver but pins its own image;
 * `ai`, `pgdog`, `proxy` have no config-level element at all) stay flat.
 *
 * Always fully explicit — `images` has no hidden default merge. Omitted keys
 * mean "no container for that role," never "inherit a default image."
 */
export interface ImagesConfig {
  readonly store?: {
    readonly sql?: string;
    readonly kv?: string;
    readonly files?: string;
    readonly index?: string;
  };
  readonly channel?: {
    readonly email?: string;
  };
  readonly vault?: string;
  readonly ai?: string;
  readonly pgdog?: string;
  readonly proxy?: string;
}

/**
 * Flatten {@link ImagesConfig} to the dotted-role `Record<string, string>`
 * every internal consumer (compose role matching, credentials, env prefixes)
 * has always kept working with — the nesting is a config-surface / type-safety
 * concern only, not an internal representation change.
 *
 * @param images - Nested config-surface images (or `undefined`)
 */
export function flattenImagesConfig(
  images: ImagesConfig | undefined,
): Readonly<Record<string, string>> {
  if (!images) return {};
  const out: Record<string, string> = {};
  if (images.store?.sql) out["store.sql"] = images.store.sql;
  if (images.store?.kv) out["store.kv"] = images.store.kv;
  if (images.store?.files) out["store.files"] = images.store.files;
  if (images.store?.index) out["store.index"] = images.store.index;
  if (images.channel?.email) out["channel.email"] = images.channel.email;
  if (images.vault) out.vault = images.vault;
  if (images.ai) out.ai = images.ai;
  if (images.pgdog) out.pgdog = images.pgdog;
  if (images.proxy) out.proxy = images.proxy;
  return out;
}

/** i18n config. */
export interface I18nConfig {
  readonly locales?: readonly string[];
  readonly default?: string;
  readonly dir?: Readonly<Record<string, "ltr" | "rtl">>;
}

/** Clock element defaults in {@link defineConfig}. */
export interface ClockConfig {
  /**
   * Default IANA timezone for `clock()` declarations that omit `timezone`.
   * Overridden by `oke({ clock: { timezone } })` and by per-clock `timezone`.
   */
  readonly timezone?: string;
}

/** Context passed to {@link TenancyConfig.resolve} (Skyport / multi-tenant). */
export interface TenancyResolveContext {
  readonly auth: {
    readonly orgId?: string | null;
  };
  readonly [key: string]: unknown;
}

/** Tenancy config. */
export interface TenancyConfig {
  readonly isolation?: "row" | "schema" | "database";
  /** Tenant resolver — opaque string id or function (Skyport). */
  readonly resolve?: string | ((ctx: TenancyResolveContext) => string | null | undefined);
}

/** Port overrides (defaults: app 6530 · console 6533 · mcp 6535). */
export interface PortsConfig {
  readonly app?: number;
  readonly console?: number;
  readonly mcp?: number;
}

/** Console production surface. */
export interface ConsoleConfig {
  readonly prod?: {
    readonly enabled?: boolean;
    readonly auth?: "required" | "optional" | "none";
  };
}

/**
 * Runs retention / redaction at the config surface (privacy state derivation).
 * Distinct from {@link DriversConfig.runs} (driver map under `drivers`).
 */
export interface RunsConfig {
  /**
   * How long to keep Parquet partitions (`"7d"`, `"30d"`, `"forever"`).
   * Distinct from {@link redact} (PII field policy, not deletion).
   */
  readonly keep?: string | "forever";
  /** Field → retention duration for redaction (privacy on when present). */
  readonly redact?: Readonly<Record<string, string>>;
}

/**
 * Optional privacy block — presence turns CORE `privacy` on in Plugins panel.
 */
export type PrivacyConfig = Readonly<Record<string, unknown>>;

/**
 * Domain schema sync via drizzle-kit (`oke db push|generate|migrate`).
 *
 * Distinct from `oke schema generate` (core/plugin stub tables).
 */
export interface DbConfig {
  /**
   * Auto-run `oke db push` when domain schema files change under `oke dev`.
   * Default `true`. Set `false` to opt out explicitly.
   * Forced off for `prod`.
   */
  readonly autoPush?: boolean;
  /**
   * Path to `drizzle.config.ts` (relative to project root).
   * Default `"drizzle.config.ts"`.
   */
  readonly config?: string;
  /**
   * Abstract schema declare module (`store.schema.table` exports).
   * When present, `oke db` emits Drizzle into {@link generated} before sync.
   * Default `"src/db/schema.decl.ts"` (legacy `"src/schema.decl.ts"` still resolved).
   */
  readonly declare?: string;
  /**
   * Generated Drizzle schema path written from abstract decls.
   * Default `"src/db/schema.drizzle.ts"` (prior `"src/db/schema.generated.ts"`;
   * legacy `"src/schema.generated.ts"`).
   * Point `drizzle.config.ts` `schema` at this file when using the abstract path.
   */
  readonly generated?: string;
  /**
   * App entry used to collect live `.plug()` table contributions for emit.
   * Default: `package.json` `okengine.entry` / `src/app.ts` (same as `oke start`).
   */
  readonly entry?: string;
}

/**
 * Application config returned by {@link defineConfig}.
 */
export interface OkeConfig {
  readonly drivers?: DriversConfig;
  readonly images?: ImagesConfig;
  readonly i18n?: I18nConfig;
  /** Default Clock timezone (and future clock element defaults). */
  readonly clock?: ClockConfig;
  readonly tenancy?: TenancyConfig;
  /**
   * Privacy tooling / redact policy. Presence (or {@link RunsConfig.redact})
   * marks CORE `privacy` as on — not a separate `.plug()` call.
   */
  readonly privacy?: PrivacyConfig;
  /**
   * Top-level runs retention. `runs.redact` turns CORE `privacy` on.
   * Not the same key as `drivers.runs`.
   */
  readonly runs?: RunsConfig;
  /**
   * Domain Drizzle schema sync (`oke db …`). Not related to `oke schema`.
   */
  readonly db?: DbConfig;
  /**
   * Encrypted-at-rest Vault settings (algorithm, master key, audit, seal).
   * Contracts stay in code — this block only configures the backend.
   */
  readonly vault?: VaultElementConfig;
  readonly topology?: "monolith" | "services";
  readonly ports?: PortsConfig;
  readonly console?: ConsoleConfig;
}

/**
 * Whether domain auto-DDL (`ensureFromMeta`) should run for this env.
 *
 * - `ensure` — `CREATE TABLE IF NOT EXISTS` on first touch (test / dev opt-out)
 * - `off` — migrations / `oke db push` own DDL (dev+autoPush, prod)
 */
export type DomainDdlMode = "ensure" | "off";

/**
 * Resolve domain DDL policy from env + `db.autoPush`.
 *
 * @param env - Active config env
 * @param autoPush - Effective auto-push flag (default true)
 */
export function resolveDomainDdlMode(env: ConfigEnv, autoPush = true): DomainDdlMode {
  if (env === "test") return "ensure";
  if (env === "prod") return "off";
  return autoPush ? "off" : "ensure";
}

/**
 * Extract the protocol id from a {@link DriverRef}.
 *
 * @param ref - Driver ref
 */
export function driverRefId(ref: DriverRef | undefined): string | undefined {
  if (ref === undefined) return undefined;
  return typeof ref === "string" ? ref : ref.driver;
}

/**
 * True when `value` is a bare driver pin (string or `{ driver, … }`), not an env map.
 *
 * @param value - Unknown driver input
 */
function isBareDriverRef(value: unknown): value is DriverRef {
  if (typeof value === "string") return true;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.driver === "string";
}

/**
 * Expand a bare {@link DriverRef} to all three env keys.
 *
 * @param ref - Driver ref applied to every env
 */
export function expandDriverRefToMap(ref: DriverRef): EnvDriverMap {
  return { dev: ref, test: ref, prod: ref };
}

/**
 * Expand a bare driver pin to `{ dev, test, prod }`, or pass through a map.
 *
 * @param raw - Env → driver map, bare ref, or undefined
 */
export function normalizeEnvDriverMap(raw: EnvDriverInput | undefined): EnvDriverMap | undefined {
  if (raw === undefined) return undefined;
  if (isBareDriverRef(raw)) return expandDriverRefToMap(raw);
  const record = raw as EnvDriverMap;
  const out: EnvDriverMap = {};
  if (record.dev !== undefined) out.dev = record.dev;
  if (record.test !== undefined) out.test = record.test;
  if (record.prod !== undefined) out.prod = record.prod;
  return out;
}

/**
 * Apply `fn` to every env-driver slot under a drivers block.
 *
 * @param drivers - Drivers block
 * @param fn - Per-slot transform
 */
function mapDriversSlots(
  drivers: DriversConfig,
  fn: (input: EnvDriverInput | undefined) => EnvDriverInput | undefined,
): DriversConfig {
  const store = drivers.store
    ? {
        ...drivers.store,
        sql: fn(drivers.store.sql),
        kv: fn(drivers.store.kv),
        files: fn(drivers.store.files),
        index: fn(drivers.store.index),
      }
    : undefined;
  const channel = drivers.channel
    ? {
        ...drivers.channel,
        email: fn(drivers.channel.email),
        sms: fn(drivers.channel.sms),
        whatsapp: fn(drivers.channel.whatsapp),
        push: fn(drivers.channel.push),
      }
    : undefined;
  return {
    ...drivers,
    ...(store !== undefined ? { store } : {}),
    signal: fn(drivers.signal),
    clock: fn(drivers.clock),
    journal: fn(drivers.journal),
    vault: fn(drivers.vault),
    ...(channel !== undefined ? { channel } : {}),
    ai: fn(drivers.ai),
    runs: fn(drivers.runs),
  };
}

/**
 * Normalize every env map under a drivers block (expand shorthand + rewrite keys).
 *
 * @param drivers - Drivers block
 */
export function normalizeDriversConfig(
  drivers: DriversConfig | undefined,
): DriversConfig | undefined {
  if (!drivers) return undefined;
  return mapDriversSlots(drivers, normalizeEnvDriverMap);
}

/**
 * Merge a developer's partial {@link EnvDriverMap} onto the real default map
 * for one specific driver — per environment key, never a whole-object
 * replace. An unset key keeps that driver's own real default; it never
 * inherits a sibling key's value.
 *
 * @param override - Developer-supplied partial map (may be `undefined`)
 * @param defaults - Real, already-established default map for this driver
 */
export function mergeEnvDriverMap(
  override: EnvDriverMap | undefined,
  defaults: EnvDriverMap,
): EnvDriverMap {
  return {
    dev: override?.dev ?? defaults.dev,
    test: override?.test ?? defaults.test,
    prod: override?.prod ?? defaults.prod,
  };
}

/**
 * Fill missing `dev` pins from `prod` (compose laptop ≈ production protocols).
 *
 * @param map - Env → driver map
 */
export function fillDevFromProd(map: EnvDriverMap | undefined): EnvDriverMap | undefined {
  if (!map) return undefined;
  if (map.dev !== undefined || map.prod === undefined) return map;
  return { ...map, dev: map.prod };
}

/**
 * Copy production driver pins onto `dev` wherever `dev` is omitted.
 *
 * @param drivers - Drivers block
 */
export function fillDriversDevFromProd(
  drivers: DriversConfig | undefined,
): DriversConfig | undefined {
  if (!drivers) return undefined;
  return mapDriversSlots(drivers, (input) => fillDevFromProd(input as EnvDriverMap | undefined));
}

/**
 * Walk every driver pin and throw if `sqlite` appears or test SQL is not `pglite`.
 *
 * @param drivers - Normalized drivers block
 */
export function assertDriverSafety(drivers: DriversConfig | undefined): void {
  if (!drivers) return;
  const maps: readonly (EnvDriverMap | undefined)[] = [
    drivers.store?.sql as EnvDriverMap | undefined,
    drivers.store?.kv as EnvDriverMap | undefined,
    drivers.store?.files as EnvDriverMap | undefined,
    drivers.store?.index as EnvDriverMap | undefined,
    drivers.signal as EnvDriverMap | undefined,
    drivers.clock as EnvDriverMap | undefined,
    drivers.journal as EnvDriverMap | undefined,
    drivers.vault as EnvDriverMap | undefined,
    drivers.channel?.email as EnvDriverMap | undefined,
    drivers.channel?.sms as EnvDriverMap | undefined,
    drivers.channel?.whatsapp as EnvDriverMap | undefined,
    drivers.channel?.push as EnvDriverMap | undefined,
    drivers.ai as EnvDriverMap | undefined,
    drivers.runs as EnvDriverMap | undefined,
  ];
  for (const map of maps) {
    if (!map) continue;
    for (const env of ["dev", "test", "prod"] as const) {
      const id = driverRefId(map[env]);
      if (id === "sqlite" || id === "libsql") {
        throw new Error(
          `oke.config: "${id}" was removed — use postgres (dev/prod) or pglite (test); index → pgvector/memory`,
        );
      }
    }
  }
  const sqlTest = driverRefId((drivers.store?.sql as EnvDriverMap | undefined)?.test);
  if (sqlTest !== undefined && sqlTest !== "pglite") {
    throw new Error(`oke.config: drivers.store.sql.test must be "pglite" (got "${sqlTest}")`);
  }
}

/**
 * Define an `oke.config.ts` document.
 *
 * Bare string pins expand to all three envs. Missing `dev` pins fill from
 * `prod`. Rejects `sqlite` / `libsql` and non-`pglite` test SQL.
 *
 * @param config - Driver / tenancy / i18n / topology
 */
export function defineConfig(config: OkeConfig): OkeConfig {
  if (!config.drivers) return config;
  const normalized = normalizeDriversConfig(config.drivers);
  const filled = fillDriversDevFromProd(normalized);
  assertDriverSafety(filled);
  return {
    ...config,
    drivers: filled,
  };
}

/**
 * Resolve a driver id for an env from an {@link EnvDriverMap}.
 *
 * With `defaults` given, the developer's map is merged onto it per-key via
 * {@link mergeEnvDriverMap} and the active env's slot is read directly — a
 * key the developer never set keeps that driver's real default, full stop.
 *
 * Without `defaults` (legacy path — `store.index`, `channel.whatsapp` /
 * `push`, `ai`): cascade is `env → dev → prod → test`.
 *
 * @param map - Env → driver map (or bare ref)
 * @param env - Active environment
 * @param defaults - Real default map for this specific driver (per-key merge)
 */
export function resolveDriverId(
  map: EnvDriverInput | undefined,
  env: ConfigEnv,
  defaults?: EnvDriverMap,
): string | undefined {
  const normalized = normalizeEnvDriverMap(map);
  if (defaults) {
    const merged = mergeEnvDriverMap(normalized, defaults);
    return driverRefId(merged[env]);
  }
  if (!normalized) return undefined;
  const ref = normalized[env] ?? normalized.dev ?? normalized.prod ?? normalized.test;
  return driverRefId(ref);
}
