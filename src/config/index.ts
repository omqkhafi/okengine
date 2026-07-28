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
  readonly vault?: EnvDriverMap;
  readonly channel?: ChannelDriversConfig;
  readonly ai?: EnvDriverMap;
  readonly runs?: EnvDriverMap;
}

/** Image lock entries keyed by element role (`store.sql`, …). */
export type ImagesConfig = Readonly<Record<string, string>>;

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
   * Default `"src/schema.decl.ts"` (emit skipped if the file is absent).
   */
  readonly declare?: string;
  /**
   * Generated Drizzle schema path written from abstract decls.
   * Default `"src/schema.generated.ts"`. Point `drizzle.config.ts` `schema`
   * at this file when using the abstract path.
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
    vault: normalizeEnvDriverMap(drivers.vault as RawEnvDriverMap),
    ...(channel !== undefined ? { channel } : {}),
    ai: normalizeEnvDriverMap(drivers.ai as RawEnvDriverMap),
    runs: normalizeEnvDriverMap(drivers.runs as RawEnvDriverMap),
  };
}

/**
 * Fill missing `docker` pins from `prod` (compose infra ≈ production protocols).
 *
 * Vault is the exception: `prod: "sops"` becomes `docker: "dotenv"` so
 * `oke dev -d` can read `docker/.env.docker` without age keys.
 *
 * @param map - Env → driver map
 * @param options - Element-specific defaults
 */
export function fillDockerFromProd(
  map: EnvDriverMap | undefined,
  options: { readonly vault?: boolean } = {},
): EnvDriverMap | undefined {
  if (!map) return undefined;
  if (map.docker !== undefined || map.prod === undefined) return map;
  if (options.vault) {
    const prodId = typeof map.prod === "string" ? map.prod : map.prod.driver;
    if (prodId === "sops") {
      return { ...map, docker: "dotenv" };
    }
  }
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
    vault: fillDockerFromProd(drivers.vault, { vault: true }),
    ...(channel !== undefined ? { channel } : {}),
    ai: fillDockerFromProd(drivers.ai),
    runs: fillDockerFromProd(drivers.runs),
  };
}

/**
 * Define an `oke.config.ts` document.
 *
 * Missing `docker` driver pins are filled from `prod` so `oke dev -d` uses the
 * same server protocols as production (vault → dotenv for `docker/.env.docker`).
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
 * `docker` falls back to `prod` then `local` so existing configs keep working
 * until an explicit `docker:` pin is added. Legacy keys are normalized first.
 *
 * @param map - Env → driver map
 * @param env - Active environment
 */
export function resolveDriverId(
  map: EnvDriverMap | RawEnvDriverMap | undefined,
  env: ConfigEnv,
): string | undefined {
  if (!map) return undefined;
  const normalized = normalizeEnvDriverMap(map as RawEnvDriverMap) ?? map;
  const ref =
    env === "docker"
      ? (normalized.docker ?? normalized.prod ?? normalized.local ?? normalized.test)
      : (normalized[env] ?? normalized.local ?? normalized.test);
  if (ref === undefined) return undefined;
  return typeof ref === "string" ? ref : ref.driver;
}
