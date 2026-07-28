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
export type RawEnvDriverMap = Partial<
  Record<ConfigEnv | LegacyConfigEnv, DriverRef>
>;

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

/** Whether a legacy-key deprecation warning was already emitted this process. */
let legacyKeyWarned = false;

/**
 * Normalize deprecated `dev`/`stack` driver-map keys to `local`/`docker`.
 *
 * Emits a one-time stderr warning when legacy keys are present.
 *
 * @param map - Env → driver map (possibly legacy)
 */
export function normalizeEnvDriverMap(
  map: RawEnvDriverMap | EnvDriverMap | undefined,
): EnvDriverMap | undefined {
  if (!map) return undefined;
  const raw = map as RawEnvDriverMap;
  const hasLegacy = raw.dev !== undefined || raw.stack !== undefined;
  if (hasLegacy && !legacyKeyWarned) {
    legacyKeyWarned = true;
    console.warn(
      "oke: driver map keys `dev`/`stack` are deprecated — use `local`/`docker` (run `oke upgrade`)",
    );
  }
  const out: EnvDriverMap = {};
  if (raw.local !== undefined) out.local = raw.local;
  else if (raw.dev !== undefined) out.local = raw.dev;
  if (raw.docker !== undefined) out.docker = raw.docker;
  else if (raw.stack !== undefined) out.docker = raw.stack;
  if (raw.test !== undefined) out.test = raw.test;
  if (raw.prod !== undefined) out.prod = raw.prod;
  return out;
}

/**
 * Normalize every env driver map under a drivers block.
 *
 * @param drivers - Drivers block (possibly with legacy keys)
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
        whatsapp: normalizeEnvDriverMap(
          drivers.channel.whatsapp as RawEnvDriverMap,
        ),
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
 * Fill missing `docker` pins from `prod` (compose mode ≈ production protocols).
 *
 * @param map - Env → driver map
 */
export function fillDockerFromProd(
  map: EnvDriverMap | undefined,
): EnvDriverMap | undefined {
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
    vault: fillDockerFromProd(drivers.vault),
    ...(channel !== undefined ? { channel } : {}),
    ai: fillDockerFromProd(drivers.ai),
    runs: fillDockerFromProd(drivers.runs),
  };
}

/**
 * @deprecated Use {@link fillDockerFromProd}.
 */
export const fillStackFromProd = fillDockerFromProd;

/**
 * @deprecated Use {@link fillDriversDockerFromProd}.
 */
export const fillDriversStackFromProd = fillDriversDockerFromProd;

/**
 * Define an `oke.config.ts` document.
 *
 * Missing `docker` driver pins are filled from `prod` so `oke dev -d` uses the
 * same server protocols as production (including vault `sops`).
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
 * Options for {@link resolveConfigEnv}.
 */
export interface ResolveConfigEnvOptions {
  /** Explicit driver-map key from `app.boot({ env })` / `$options.env`. */
  readonly env?: ConfigEnv;
  /**
   * Docker compose mode. `true` forces `docker`; `false` ignores `OKE_DOCKER`;
   * omit to consult {@link ResolveConfigEnvOptions.okeDocker} / `process.env`.
   */
  readonly docker?: boolean;
  /** Override `NODE_ENV` (tests). Defaults to `process.env.NODE_ENV`. */
  readonly nodeEnv?: string;
  /** Override `OKE_DOCKER` (tests). Defaults to `process.env.OKE_DOCKER`. */
  readonly okeDocker?: string;
}

/**
 * Resolve the active {@link ConfigEnv} for boot / driver maps.
 *
 * Precedence:
 * 1. Docker mode (`docker: true` or `OKE_DOCKER=1`) → `docker`
 * 2. Explicit `env`
 * 3. `NODE_ENV=production` → `prod`
 * 4. `NODE_ENV=test` → `test`
 * 5. otherwise `local`
 *
 * Staging is not a fifth key — deploy a second copy with `prod` drivers and
 * different `process.env` values (see handbook Deploy).
 *
 * @param options - Explicit env / docker / Node env overrides
 */
export function resolveConfigEnv(
  options: ResolveConfigEnvOptions = {},
): ConfigEnv {
  const okeDocker = options.okeDocker ?? process.env.OKE_DOCKER;
  const docker =
    options.docker === true ||
    (options.docker !== false && okeDocker === "1");
  if (docker) return "docker";
  if (options.env !== undefined) return options.env;
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv === "production") return "prod";
  if (nodeEnv === "test") return "test";
  return "local";
}

/**
 * Resolve a driver id for an env from an {@link EnvDriverMap}.
 *
 * `docker` falls back to `prod` then `local` so existing configs keep working
 * until an explicit `docker:` pin is added.
 *
 * @param map - Env → driver map
 * @param env - Active environment
 */
export function resolveDriverId(
  map: EnvDriverMap | undefined,
  env: ConfigEnv,
): string | undefined {
  if (!map) return undefined;
  const normalized = normalizeEnvDriverMap(map as RawEnvDriverMap) ?? map;
  const ref =
    env === "docker"
      ? (normalized.docker ??
        normalized.prod ??
        normalized.local ??
        normalized.test)
      : (normalized[env] ?? normalized.local ?? normalized.test);
  if (ref === undefined) return undefined;
  return typeof ref === "string" ? ref : ref.driver;
}
