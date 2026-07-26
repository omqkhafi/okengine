/**
 * Normalised service + image-recipe contracts for compose derivation.
 *
 * Recipes translate a {@link ServiceSpec} into image-specific env / command /
 * healthcheck and expose {@link ImageRecipe.url} so the kernel never learns
 * an env-var name.
 */

/** Credential material for a role — never serialised into generated YAML. */
export interface ServiceCredentials {
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

/** Connection endpoint used by {@link ImageRecipe.url}. */
export interface ServiceEndpoint {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

/**
 * Normalised service description produced from config `images` + role.
 * Image-agnostic — recipes specialise it.
 */
export interface ServiceSpec {
  /** Role key (`store.sql`, `store.kv`, …). */
  readonly role: string;
  /** Compose service name (`store-sql`). */
  readonly serviceName: string;
  /** Image reference (tag or digest). */
  readonly image: string;
  /** Container listen port. */
  readonly port: number;
  /** Host port published in compose (dev defaults). */
  readonly hostPort: number;
  /** Credential placeholders (values live in `.env.stack`, not YAML). */
  readonly credentials: ServiceCredentials;
}

/** Compose healthcheck block. */
export interface ComposeHealthcheck {
  readonly test: readonly string[];
  readonly interval?: string;
  readonly timeout?: string;
  readonly retries?: number;
  readonly start_period?: string;
}

/** Image-specific compose fragment from {@link ImageRecipe.apply}. */
export interface RecipeApplyResult {
  readonly environment?: Readonly<Record<string, string>>;
  readonly command?: string | readonly string[];
  readonly healthcheck?: ComposeHealthcheck;
  readonly volumes?: readonly string[];
  readonly user?: string;
}

/**
 * Image recipe — match an image ref, specialise a {@link ServiceSpec},
 * and build a connection URL without teaching the kernel env-var names.
 */
export interface ImageRecipe {
  /** Stable recipe id (`postgres`, `redis`, …). */
  readonly id: string;
  /** Default container port when the spec does not override. */
  readonly port: number;
  /**
   * Whether this recipe handles `image`.
   *
   * @param image - Image reference
   */
  match(image: string): boolean;
  /**
   * Translate a normalised spec into image-specific compose fields.
   * Environment values must be `${VAR}` refs — never cleartext secrets.
   *
   * @param spec - Normalised service
   */
  apply(spec: ServiceSpec): RecipeApplyResult;
  /**
   * Build a driver URL from endpoint credentials.
   *
   * @param spec - Normalised service
   * @param endpoint - Host / port / credentials
   */
  url(spec: ServiceSpec, endpoint: ServiceEndpoint): string;
}

/** Options for compose / Dockerfile derivation. */
export interface DeriveOptions {
  /** Role → image pin (from `oke.config.ts` / Manifest). */
  readonly images: Readonly<Record<string, string>>;
  /** Application name (compose project / app service). */
  readonly app?: string;
  /** App listen port (default 6530). */
  readonly appPort?: number;
  /** When true, emit prod overlays (limits, secret refs, deploy.replicas). */
  readonly prod?: boolean;
  /**
   * Include the `app` service in `compose.yml` (default true).
   * `oke dev --stack` sets false — host Bun runs the app; Docker is infra only.
   */
  readonly includeApp?: boolean;
  /**
   * Compose artefact directory relative to the project root (default `docker`).
   * Controls generated `env_file` / `build.context` paths (e.g. `../.env.stack`).
   * Pass `"."` for legacy root-level layout.
   */
  readonly composeDir?: string;
  /** Output directory (default `docker`). */
  readonly outDir?: string;
  /** Inject credentials (tests). Defaults to generated randoms. */
  readonly credentials?: Readonly<Record<string, ServiceCredentials>>;
  /** Host for URL builders (default `127.0.0.1` in stack env). */
  readonly host?: string;
  /** Extra image recipes (plugins). */
  readonly recipes?: readonly ImageRecipe[];
  /**
   * Local stack instance id (6-hex). When set, host ports are offset so two
   * `oke dev -s` projects do not share one Postgres on `:5432`.
   */
  readonly instanceId?: string;
}

/** Default relative directory for generated Docker / compose artefacts. */
export const DEFAULT_DOCKER_DIR = "docker";

/** One generated file. */
export interface GeneratedFile {
  /** Relative path under `outDir`. */
  readonly path: string;
  /** File contents. */
  readonly content: string;
}

/** Result of {@link deriveInfrastructure}. */
export interface DeriveResult {
  /** Normalised specs (one per image role). */
  readonly specs: readonly ServiceSpec[];
  /** Generated files (Dockerfile + compose layers). */
  readonly files: readonly GeneratedFile[];
  /**
   * Stack env contents for `.env.stack` — written by `oke dev --stack`,
   * never embedded in YAML.
   */
  readonly stackEnv: Readonly<Record<string, string>>;
  /** Compose `-f` merge order (four override layers). */
  readonly composeFiles: readonly string[];
}
