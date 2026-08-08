/**
 * `oke.config.ts` surface. Subpath: `okengine/config`.
 *
 * Driver maps are protocol-named; vendor/image choice lives in `images`.
 * @module
 */

/**
 * Environment role keys used in driver maps.
 *
 * - `local` — laptop defaults (`oke dev` / `oke dev -l`)
 * - `docker` — compose infra + host Bun (`oke dev -d`)
 * - `test` — automated tests
 * - `prod` — production deploy
 */
export type ConfigEnv = "local" | "docker" | "test" | "prod";

/** Legacy driver-map keys accepted during soft-compat migration. */
type LegacyConfigEnv = "dev" | "stack";

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

/** Map of env → driver ref. */
export type EnvDriverMap = Partial<Record<ConfigEnv, DriverRef>>;

/**
 * Raw map that may still use deprecated `dev` / `stack` keys.
 * Normalized by {@link normalizeEnvDriverMap}.
 */
export type RawEnvDriverMap = Partial<Record<ConfigEnv | LegacyConfigEnv, DriverRef>>;

/** Store facet driver maps. */
export interface StoreDriversConfig {
  readonly sql?: EnvDriverMap;
  readonly kv?: EnvDriverMap;
  readonly files?: EnvDriverMap;
  readonly index?: EnvDriverMap;
}

/** Channel medium → env driver map. */
export interface ChannelDriversConfig {
  readonly email?: EnvDriverMap;
  readonly sms?: EnvDriverMap;
  readonly whatsapp?: EnvDriverMap;
  readonly push?: EnvDriverMap;
}

/** Top-level drivers block in {@link OkeConfig}. */
export interface DriversConfig {
  /**
   * Flat prod protocol list (Manifest `drivers.prod`).
   * Optional — nested maps are preferred for boot binding.
   */
  readonly prod?: readonly string[];
  readonly store?: StoreDriversConfig;
  readonly signal?: EnvDriverMap;
  readonly clock?: EnvDriverMap;
  /** Durable-run journal: `memory` · `file` · `postgres`. */
  readonly journal?: EnvDriverMap;
  readonly vault?: EnvDriverMap;
  readonly channel?: ChannelDriversConfig;
  readonly ai?: EnvDriverMap;
  readonly runs?: EnvDriverMap;
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
   * Auto-run `oke db push` when domain schema files change under `oke dev`
   * (local mode only). Default `true`. Set `false` to opt out explicitly.
   * Forced off for `docker` / `prod`.
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
   * Default `"src/db/schema.generated.ts"` (legacy `"src/schema.generated.ts"`).
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
  readonly topology?: "monolith" | "services";
  readonly ports?: PortsConfig;
  readonly console?: ConsoleConfig;
}

/**
 * Whether domain auto-DDL (`ensureFromMeta`) should run for this env.
 *
 * - `ensure` — `CREATE TABLE IF NOT EXISTS` on first touch (test / local opt-out)
 * - `off` — migrations / `oke db push` own DDL (docker, prod, local+autoPush)
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
  if (env === "docker" || env === "prod") return "off";
  return autoPush ? "off" : "ensure";
}

/** Whether a legacy-key deprecation warning was already emitted this process. */
let legacyKeyWarned = false;

/**
 * Normalize deprecated `dev`/`stack` driver-map keys to `local`/`docker`.
 *
 * Emits a one-time stderr warning when legacy keys are present.
 *
 * @param raw - Env → driver map (possibly legacy keys)
 */
export function normalizeEnvDriverMap(
  raw: RawEnvDriverMap | EnvDriverMap | undefined,
): EnvDriverMap | undefined {
  if (!raw) return undefined;
  const hasLegacy =
    (raw as RawEnvDriverMap).dev !== undefined || (raw as RawEnvDriverMap).stack !== undefined;
  if (hasLegacy && !legacyKeyWarned) {
    legacyKeyWarned = true;
    console.warn(
      "oke: driver map keys `dev`/`stack` are deprecated — use `local`/`docker` (run `oke upgrade`)",
    );
  }
  const out: EnvDriverMap = { ...(raw as EnvDriverMap) };
  const legacy = raw as RawEnvDriverMap;
  if (legacy.local === undefined && legacy.dev !== undefined) {
    out.local = legacy.dev;
  }
  if (legacy.docker === undefined && legacy.stack !== undefined) {
    out.docker = legacy.stack;
  }
  delete (out as RawEnvDriverMap).dev;
  delete (out as RawEnvDriverMap).stack;
  return out;
}

/**
 * Normalize every env map under a drivers block.
 *
 * @param drivers - Drivers block
 */
export function normalizeDriversConfig(
  drivers: DriversConfig | undefined,
): DriversConfig | undefined {
  if (!drivers) return undefined;
  const store = drivers.store
    ? {
        ...drivers.store,
        sql: normalizeEnvDriverMap(drivers.store.sql as RawEnvDriverMap),
        kv: normalizeEnvDriverMap(drivers.store.kv as RawEnvDriverMap),
        files: normalizeEnvDriverMap(drivers.store.files as RawEnvDriverMap),
        index: normalizeEnvDriverMap(drivers.store.index as RawEnvDriverMap),
      }
    : undefined;
  const channel = drivers.channel
    ? {
        ...drivers.channel,
        email: normalizeEnvDriverMap(drivers.channel.email as RawEnvDriverMap),
        sms: normalizeEnvDriverMap(drivers.channel.sms as RawEnvDriverMap),
        whatsapp: normalizeEnvDriverMap(drivers.channel.whatsapp as RawEnvDriverMap),
        push: normalizeEnvDriverMap(drivers.channel.push as RawEnvDriverMap),
      }
    : undefined;
  return {
    ...drivers,
    ...(store !== undefined ? { store } : {}),
    signal: normalizeEnvDriverMap(drivers.signal as RawEnvDriverMap),
    clock: normalizeEnvDriverMap(drivers.clock as RawEnvDriverMap),
    journal: normalizeEnvDriverMap(drivers.journal as RawEnvDriverMap),
    vault: normalizeEnvDriverMap(drivers.vault as RawEnvDriverMap),
    ...(channel !== undefined ? { channel } : {}),
    ai: normalizeEnvDriverMap(drivers.ai as RawEnvDriverMap),
    runs: normalizeEnvDriverMap(drivers.runs as RawEnvDriverMap),
  };
}

/**
 * Merge a developer's partial {@link EnvDriverMap} onto the real default map
 * for one specific driver — per environment key, never a whole-object
 * replace. An unset key keeps that driver's own real default; it never
 * inherits a sibling key's value (the old `docker → prod → local → test`
 * cascade in {@link resolveDriverId} did that, which is exactly the bug this
 * fixes — `{ local: "pglite" }` no longer leaks `pglite` into `docker`).
 *
 * Scoped strictly to the `{ local?, docker?, test?, prod? }` shape — not a
 * generic deep merge, and never applied to a whole config object.
 *
 * @param override - Developer-supplied partial map (may be `undefined`)
 * @param defaults - Real, already-established default map for this driver
 */
export function mergeEnvDriverMap(
  override: EnvDriverMap | undefined,
  defaults: EnvDriverMap,
): EnvDriverMap {
  return {
    local: override?.local ?? defaults.local,
    docker: override?.docker ?? defaults.docker,
    test: override?.test ?? defaults.test,
    prod: override?.prod ?? defaults.prod,
  };
}

/**
 * Fill missing `docker` pins from `prod` (compose infra ≈ production protocols).
 *
 * @param map - Env → driver map
 */
export function fillDockerFromProd(map: EnvDriverMap | undefined): EnvDriverMap | undefined {
  if (!map) return undefined;
  if (map.docker !== undefined || map.prod === undefined) return map;
  return { ...map, docker: map.prod };
}

/**
 * Copy production driver pins onto `docker` wherever `docker` is omitted.
 *
 * @param drivers - Drivers block
 */
export function fillDriversDockerFromProd(
  drivers: DriversConfig | undefined,
): DriversConfig | undefined {
  if (!drivers) return undefined;
  const store = drivers.store
    ? {
        ...drivers.store,
        sql: fillDockerFromProd(drivers.store.sql),
        kv: fillDockerFromProd(drivers.store.kv),
        files: fillDockerFromProd(drivers.store.files),
        index: fillDockerFromProd(drivers.store.index),
      }
    : undefined;
  const channel = drivers.channel
    ? {
        ...drivers.channel,
        email: fillDockerFromProd(drivers.channel.email),
        sms: fillDockerFromProd(drivers.channel.sms),
        whatsapp: fillDockerFromProd(drivers.channel.whatsapp),
        push: fillDockerFromProd(drivers.channel.push),
      }
    : undefined;
  return {
    ...drivers,
    ...(store !== undefined ? { store } : {}),
    signal: fillDockerFromProd(drivers.signal),
    clock: fillDockerFromProd(drivers.clock),
    journal: fillDockerFromProd(drivers.journal),
    vault: fillDockerFromProd(drivers.vault),
    ...(channel !== undefined ? { channel } : {}),
    ai: fillDockerFromProd(drivers.ai),
    runs: fillDockerFromProd(drivers.runs),
  };
}

/**
 * Define an `oke.config.ts` document.
 *
 * Missing `docker` driver pins are filled from `prod` so `oke dev -d` uses the
 * same server protocols as production (vault → `env` for `docker/.env.docker`).
 * Legacy `dev`/`stack` keys are normalized to `local`/`docker`.
 *
 * @param config - Driver / tenancy / i18n / topology
 */
export function defineConfig(config: OkeConfig): OkeConfig {
  if (!config.drivers) return config;
  const normalized = normalizeDriversConfig(config.drivers);
  return {
    ...config,
    drivers: fillDriversDockerFromProd(normalized),
  };
}

/**
 * Resolve a driver id for an env from an {@link EnvDriverMap}.
 *
 * With `defaults` given, the developer's map is merged onto it per-key via
 * {@link mergeEnvDriverMap} and the active env's slot is read directly — a
 * key the developer never set keeps that driver's real default, full stop.
 * This is the path every driver map with an established default should use.
 *
 * Without `defaults` (legacy path — `store.index`, `channel.whatsapp` /
 * `push`, `ai`, which have no single established default table): `docker`
 * falls back to `prod` then `local` then `test` so existing configs keep
 * working until an explicit `docker:` pin is added. Legacy `dev`/`stack`
 * keys are normalized first either way.
 *
 * @param map - Env → driver map
 * @param env - Active environment
 * @param defaults - Real default map for this specific driver (per-key merge)
 */
export function resolveDriverId(
  map: EnvDriverMap | RawEnvDriverMap | undefined,
  env: ConfigEnv,
  defaults?: EnvDriverMap,
): string | undefined {
  const normalized = normalizeEnvDriverMap(map as RawEnvDriverMap);
  if (defaults) {
    const merged = mergeEnvDriverMap(normalized, defaults);
    const ref = merged[env];
    if (ref === undefined) return undefined;
    return typeof ref === "string" ? ref : ref.driver;
  }
  if (!map) return undefined;
  const resolved = normalized ?? map;
  const ref =
    env === "docker"
      ? (resolved.docker ?? resolved.prod ?? resolved.local ?? resolved.test)
      : (resolved[env] ?? resolved.local ?? resolved.test);
  if (ref === undefined) return undefined;
  return typeof ref === "string" ? ref : ref.driver;
}
