/**
 * `oke.config.ts` surface. Subpath: `okengine/config`.
 *
 * Driver maps are protocol-named; vendor/image choice lives in `images`.
 * @module
 */

/**
 * Environment role keys used in driver maps.
 *
 * - `dev` — local laptop (`oke dev`)
 * - `stack` — local server (`oke dev -s` / compose infra + host Bun)
 * - `test` — automated tests
 * - `prod` — production deploy
 */
export type ConfigEnv = "dev" | "stack" | "test" | "prod";

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
  readonly resolve?:
    | string
    | ((ctx: TenancyResolveContext) => string | null | undefined);
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
  readonly topology?: "monolith" | "services";
  readonly ports?: PortsConfig;
  readonly console?: ConsoleConfig;
}

/**
 * Fill missing `stack` pins from `prod` (local server ≈ production protocols).
 *
 * Vault is the exception: `prod: "sops"` becomes `stack: "dotenv"` so
 * `oke dev -s` can read `.env.stack` without age keys.
 *
 * @param map - Env → driver map
 * @param options - Element-specific defaults
 */
export function fillStackFromProd(
  map: EnvDriverMap | undefined,
  options: { readonly vault?: boolean } = {},
): EnvDriverMap | undefined {
  if (!map) return undefined;
  if (map.stack !== undefined || map.prod === undefined) return map;
  if (options.vault) {
    const prodId = typeof map.prod === "string" ? map.prod : map.prod.driver;
    if (prodId === "sops") {
      return { ...map, stack: "dotenv" };
    }
  }
  return { ...map, stack: map.prod };
}

/**
 * Copy production driver pins onto `stack` wherever `stack` is omitted.
 *
 * @param drivers - Drivers block
 */
export function fillDriversStackFromProd(
  drivers: DriversConfig | undefined,
): DriversConfig | undefined {
  if (!drivers) return undefined;
  const store = drivers.store
    ? {
        ...drivers.store,
        sql: fillStackFromProd(drivers.store.sql),
        kv: fillStackFromProd(drivers.store.kv),
        files: fillStackFromProd(drivers.store.files),
        index: fillStackFromProd(drivers.store.index),
      }
    : undefined;
  const channel = drivers.channel
    ? {
        ...drivers.channel,
        email: fillStackFromProd(drivers.channel.email),
        sms: fillStackFromProd(drivers.channel.sms),
        whatsapp: fillStackFromProd(drivers.channel.whatsapp),
        push: fillStackFromProd(drivers.channel.push),
      }
    : undefined;
  return {
    ...drivers,
    ...(store !== undefined ? { store } : {}),
    signal: fillStackFromProd(drivers.signal),
    clock: fillStackFromProd(drivers.clock),
    vault: fillStackFromProd(drivers.vault, { vault: true }),
    ...(channel !== undefined ? { channel } : {}),
    ai: fillStackFromProd(drivers.ai),
    runs: fillStackFromProd(drivers.runs),
  };
}

/**
 * Define an `oke.config.ts` document.
 *
 * Missing `stack` driver pins are filled from `prod` so `oke dev -s` uses the
 * same server protocols as production (vault → dotenv for `.env.stack`).
 *
 * @param config - Driver / tenancy / i18n / topology
 */
export function defineConfig(config: OkeConfig): OkeConfig {
  if (!config.drivers) return config;
  return {
    ...config,
    drivers: fillDriversStackFromProd(config.drivers),
  };
}

/**
 * Resolve a driver id for an env from an {@link EnvDriverMap}.
 *
 * `stack` falls back to `prod` then `dev` so existing configs keep working
 * until an explicit `stack:` pin is added.
 *
 * @param map - Env → driver map
 * @param env - Active environment
 */
export function resolveDriverId(
  map: EnvDriverMap | undefined,
  env: ConfigEnv,
): string | undefined {
  if (!map) return undefined;
  const ref =
    env === "stack"
      ? (map.stack ?? map.prod ?? map.dev ?? map.test)
      : (map[env] ?? map.dev ?? map.test);
  if (ref === undefined) return undefined;
  return typeof ref === "string" ? ref : ref.driver;
}
