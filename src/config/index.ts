/**
 * `oke.config.ts` surface. Subpath: `okengine/config`.
 *
 * Driver maps are protocol-named; vendor/image choice lives in `images`.
 */

/** Environment role keys used in driver maps. */
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
 * Application config returned by {@link defineConfig}.
 */
export interface OkeConfig {
  readonly drivers?: DriversConfig;
  readonly images?: ImagesConfig;
  readonly i18n?: I18nConfig;
  readonly tenancy?: TenancyConfig;
  readonly topology?: "monolith" | "services";
  readonly ports?: PortsConfig;
  readonly console?: ConsoleConfig;
}

/**
 * Define an `oke.config.ts` document (identity function + type check).
 *
 * @param config - Driver / tenancy / i18n / topology
 */
export function defineConfig<C extends OkeConfig>(config: C): C {
  return config;
}

/**
 * Resolve a driver id for an env from an {@link EnvDriverMap}.
 *
 * @param map - Env → driver map
 * @param env - Active environment
 */
export function resolveDriverId(
  map: EnvDriverMap | undefined,
  env: ConfigEnv,
): string | undefined {
  if (!map) return undefined;
  const ref = map[env] ?? map.dev ?? map.test;
  if (ref === undefined) return undefined;
  return typeof ref === "string" ? ref : ref.driver;
}
