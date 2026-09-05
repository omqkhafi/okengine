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
  /** Credential placeholders (values live in `.env.local`, not YAML). */
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

/** Extra published host↔container port pair from a recipe. */
export interface RecipeExtraPort {
  readonly host: number;
  readonly container: number;
}

/**
 * Host bind for published ports — AI inference recipes set `127.0.0.1` so the
 * raw API never lands on `0.0.0.0` (LAN/WAN). Omit for Docker's default bind.
 */
export type RecipePublishBind = "127.0.0.1";

/** Compose `ulimits` value — soft/hard object or a single limit. */
export type RecipeUlimit = number | { readonly soft?: number; readonly hard?: number };

/** Image-specific compose fragment from {@link ImageRecipe.apply}. */
export interface RecipeApplyResult {
  readonly environment?: Readonly<Record<string, string>>;
  readonly command?: string | readonly string[];
  readonly entrypoint?: string | readonly string[];
  readonly healthcheck?: ComposeHealthcheck;
  readonly volumes?: readonly string[];
  readonly user?: string;
  /** Compose `ulimits` (e.g. Dragonfly `memlock: -1`). */
  readonly ulimits?: Readonly<Record<string, RecipeUlimit>>;
  /** Labels on this recipe's own compose service. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Additional published ports (e.g. Mailpit UI, RustFS console). */
  readonly extraPorts?: readonly RecipeExtraPort[];
  /**
   * Host interface for published ports. AI recipes use `127.0.0.1` — never
   * omit this for inference servers (raw API must not bind `0.0.0.0`).
   */
  readonly publishBind?: RecipePublishBind;
  /** Compose `ipc` (e.g. `host` for shared-memory workers). */
  readonly ipc?: string;
  /** Compose `deploy` (e.g. GPU device reservations). */
  readonly deploy?: Readonly<Record<string, unknown>>;
  /**
   * Compose `depends_on` (e.g. pooler waits for Postgres).
   * Keys are compose service names (`store-sql`), not role keys.
   */
  readonly dependsOn?: Readonly<Record<string, { readonly condition: string }>>;
  /**
   * Extra `services` entries merged into this role's compose layer —
   * companions (e.g. Docker socket proxy) or overlays on peers
   * (e.g. Traefik routing labels on `app` when `includeApp` is true).
   */
  readonly services?: Readonly<Record<string, Record<string, unknown>>>;
  /**
   * Compose `build` for locally derived images (opt-in advisor Postgres).
   * `dockerfile` is relative to the compose directory.
   */
  readonly build?: {
    readonly context: string;
    readonly dockerfile: string;
  };
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

/**
 * How derived compose artefacts are laid out under {@link DeriveOptions.composeDir}.
 *
 * - `single` (default) — one production-grade `docker-compose.yml`
 * - `split` — `compose.yml` + per-role `compose.<role>.yml` (+ `compose.prod.yml` when prod)
 * - `stack` — one Swarm-oriented `docker-stack.yml`
 */
export type ComposeLayout = "single" | "split" | "stack";

/** Options for compose / Dockerfile derivation. */
export interface DeriveOptions {
  /** Role → image pin (from `oke.config.ts` / Manifest). */
  readonly images: Readonly<Record<string, string>>;
  /** Application name (compose project / app service). */
  readonly app?: string;
  /** App listen port (default 6530). */
  readonly appPort?: number;
  /**
   * When true, fold production readiness (`/_/ready` HEALTHCHECK, deploy,
   * restart policy, secret refs) and apportion {@link serverCpus} /
   * {@link serverMemoryGb} across services. `oke docker` defaults true;
   * `oke dev --docker` keeps false.
   */
  readonly prod?: boolean;
  /**
   * Compose file layout (default `single` → `docker-compose.yml`).
   * Pass `split` for layered `compose.<role>.yml`, or `stack` for `docker-stack.yml`.
   */
  readonly layout?: ComposeLayout;
  /**
   * Host CPU count used to size `deploy.resources` when {@link prod} is true
   * (default 4).
   */
  readonly serverCpus?: number;
  /**
   * Host RAM in GiB used to size `deploy.resources` when {@link prod} is true
   * (default 8).
   */
  readonly serverMemoryGb?: number;
  /**
   * Include the `app` service in the compose document (default true).
   * `oke dev` sets false — host Bun runs the app; Docker is infra only.
   * Recipe overlays on `app` (Traefik labels) are dropped in that mode.
   */
  readonly includeApp?: boolean;
  /**
   * Compose artefact directory relative to the project root (default `docker`).
   * Controls generated `env_file` / `build.context` paths (`.env.local` lives
   * at the project root; compose under `docker/` uses `../.env.local`).
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
  /** Preserved optional controls from an existing `.env.local`. */
  readonly controls?: Readonly<Record<string, string>>;
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
   * Stack env contents merged into `.env.local` by `oke dev --docker`,
   * never embedded in YAML.
   */
  readonly stackEnv: Readonly<Record<string, string>>;
  /**
   * Compose `-f` merge order (includes a user-owned override that oke never
   * writes — callers should skip it when the file is absent).
   */
  readonly composeFiles: readonly string[];
}
