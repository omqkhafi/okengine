/**
 * Compose artefact emission — three production-grade layouts:
 *
 * - `single` (default) → `docker-compose.yml`
 * - `split` → `compose.yml` + `compose.<role>.yml` (+ `compose.prod.yml` when prod)
 * - `stack` → `docker-stack.yml` (Swarm `docker stack deploy -c`)
 *
 * User-owned overrides (`docker-compose.override.yml` / `compose.override.yml`)
 * are listed in {@link emitComposeLayers}'s `composeFiles` but never written.
 */

import { composeToYaml, defaultHostPort, envPrefix, serviceNameFor } from "./helpers.ts";
import { recipeFor } from "./recipes/index.ts";
import { allocateServiceResources, mergeDeployResources, type ServerBudget } from "./resources.ts";
import type {
  ComposeLayout,
  DeriveOptions,
  GeneratedFile,
  ImageRecipe,
  ServiceCredentials,
  ServiceSpec,
} from "./types.ts";
import { DEFAULT_DOCKER_DIR } from "./types.ts";
import { generateCredentials } from "./credentials.ts";
import { extraHostPortForInstance, hostPortForInstance, STACK_CONTROL_KEYS } from "./stack-id.ts";
import { APP_PORT } from "../runtime/types.ts";

/** Default single-file compose artefact. */
export const DOCKER_COMPOSE = "docker-compose.yml";

/** User-owned override beside {@link DOCKER_COMPOSE} — never written by oke. */
export const DOCKER_COMPOSE_OVERRIDE = "docker-compose.override.yml";

/** Swarm stack artefact (`docker stack deploy -c`). */
export const DOCKER_STACK = "docker-stack.yml";

/** Split-layout base layer. */
export const COMPOSE_BASE = "compose.yml";

/** Split-layout user override — never written by derivation. */
export const COMPOSE_OVERRIDE = "compose.override.yml";

/**
 * @deprecated Prefer {@link DOCKER_COMPOSE} or {@link DOCKER_STACK}. Kept as an
 * alias of {@link DOCKER_COMPOSE} for soft-compat with older tests / docs.
 */
export const COMPOSE_ALL = DOCKER_COMPOSE;

/**
 * Relative path refs for compose files living under {@link DeriveOptions.composeDir}.
 *
 * @param composeDir - Directory relative to project root (`docker` or `.`)
 */
export function composePathRefs(composeDir: string = DEFAULT_DOCKER_DIR): {
  readonly envFile: string;
  readonly buildContext: string;
  readonly dockerfile: string;
} {
  const flat = composeDir === "." || composeDir === "";
  return {
    envFile: flat ? ".env.local" : "../.env.local",
    buildContext: flat ? "." : "..",
    dockerfile: "Dockerfile",
  };
}

/**
 * Build normalised {@link ServiceSpec} list from image pins.
 *
 * @param options - Derive options
 */
export function buildSpecs(options: DeriveOptions): ServiceSpec[] {
  const recipes = options.recipes ?? [];
  const specs: ServiceSpec[] = [];
  for (const [role, image] of Object.entries(options.images)) {
    const recipe = recipeFor(image, recipes);
    const creds = options.credentials?.[role] ?? generateCredentials(role);
    const port = recipe.port;
    const hostPort = options.instanceId
      ? hostPortForInstance(role, port, options.instanceId)
      : defaultHostPort(role, port);
    specs.push({
      role,
      serviceName: serviceNameFor(role),
      image,
      port,
      hostPort,
      credentials: creds,
    });
  }
  return specs.sort((a, b) => a.role.localeCompare(b.role));
}

/**
 * Emit compose artefacts for the chosen {@link ComposeLayout}.
 *
 * @param specs - Normalised services
 * @param options - Derive options
 */
export function emitComposeLayers(
  specs: readonly ServiceSpec[],
  options: DeriveOptions,
): { files: GeneratedFile[]; composeFiles: string[] } {
  const recipes = options.recipes ?? [];
  const appPort = options.appPort ?? APP_PORT;
  const app = options.app ?? "app";
  const includeApp = options.includeApp !== false;
  const layout: ComposeLayout = options.layout ?? "single";
  const paths = composePathRefs(options.composeDir ?? DEFAULT_DOCKER_DIR);
  const files: GeneratedFile[] = [];
  /** Layers as objects — same merge Compose would apply via `-f` order. */
  const mergeLayers: Record<string, unknown>[] = [];

  // Layer 1 — project name + network (+ optional app for deploy / oke docker)
  const base: Record<string, unknown> = {
    name: `oke-${app}`,
    networks: {
      oke: { driver: layout === "stack" ? "overlay" : "bridge" },
    },
  };
  if (includeApp) {
    // `image` + `build`: local compose builds and tags; Swarm stack deploy
    // ignores `build` and pulls/uses the pre-built tag.
    // When an opt-in `proxy` role is present, the edge publishes 80/443 —
    // leave `app` unpublished so `docker compose up --scale app=N` works.
    const hasProxy = specs.some((s) => s.role === "proxy");
    const backendDeps = specs.filter((s) => s.role !== "proxy");
    base.services = {
      app: {
        image: `oke-${app}:latest`,
        ...(layout === "stack"
          ? {}
          : {
              build: {
                context: paths.buildContext,
                dockerfile: paths.dockerfile,
              },
            }),
        ...(hasProxy ? {} : { ports: [`${appPort}:${appPort}`] }),
        env_file: [paths.envFile],
        depends_on: Object.fromEntries(
          backendDeps.map((s) => [s.serviceName, { condition: "service_healthy" }]),
        ),
        networks: ["oke"],
      },
    };
  }
  mergeLayers.push(base);

  // Layer 2 — per-role
  const roleDocs: { readonly role: string; readonly doc: Record<string, unknown> }[] = [];
  for (const spec of specs) {
    const recipe = recipeFor(spec.image, recipes);
    const applied = recipe.apply(spec);
    const bindPrefix = applied.publishBind ? `${applied.publishBind}:` : "";
    const ports = [
      `${bindPrefix}${spec.hostPort}:${spec.port}`,
      ...(applied.extraPorts ?? []).map((p) => {
        const hostPort = options.instanceId
          ? extraHostPortForInstance(spec.role, p.host, options.instanceId)
          : p.host;
        return `${bindPrefix}${hostPort}:${p.container}`;
      }),
    ];
    const service: Record<string, unknown> = {
      image: spec.image,
      ports,
      networks: ["oke"],
      env_file: [paths.envFile],
    };
    if (applied.environment) service.environment = applied.environment;
    if (applied.build) service.build = applied.build;
    if (applied.command) service.command = applied.command;
    if (applied.entrypoint) service.entrypoint = applied.entrypoint;
    if (applied.healthcheck) service.healthcheck = applied.healthcheck;
    if (applied.volumes) service.volumes = applied.volumes;
    if (applied.user) service.user = applied.user;
    if (applied.ulimits) service.ulimits = applied.ulimits;
    if (applied.labels) service.labels = applied.labels;
    if (applied.ipc) service.ipc = applied.ipc;
    if (applied.deploy) service.deploy = applied.deploy;
    if (applied.dependsOn) {
      const deps = { ...applied.dependsOn };
      if (!includeApp) delete deps.app;
      if (Object.keys(deps).length > 0) service.depends_on = deps;
    }

    const extraServices = peerServices(applied.services, includeApp);
    const namedVolumes = namedVolumeDecls([
      ...(applied.volumes ?? []),
      ...extraServiceVolumes(extraServices),
    ]);
    const doc: Record<string, unknown> = {
      services: { [spec.serviceName]: service, ...extraServices },
      networks: { oke: { external: false } },
    };
    if (Object.keys(namedVolumes).length > 0) {
      doc.volumes = namedVolumes;
    }
    mergeLayers.push(doc);
    roleDocs.push({ role: spec.role, doc });
  }

  // Layer 3 — prod overlay (readiness + deploy policy; resources budgeted below)
  let prodDoc: Record<string, unknown> | undefined;
  if (options.prod) {
    const prodServices: Record<string, unknown> = {};
    if (includeApp) {
      prodServices.app = {
        // Single Docker HEALTHCHECK — Swarm has no separate readiness/liveness.
        // Prefer kernel readiness so the routing mesh and rolling updates wait
        // out booting / orphan_scan (see GET /_/ready). App GET /health stays
        // for external monitors only.
        healthcheck: {
          test: [
            "CMD",
            "bun",
            "-e",
            `fetch("http://127.0.0.1:${appPort}/_/ready").then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
          ],
          interval: "10s",
          timeout: "3s",
          retries: 3,
          start_period: "60s",
        },
        // Match installGracefulShutdown lease release window (≥ Signal TTL).
        stop_grace_period: "30s",
        deploy: {
          replicas: 1,
          update_config: {
            parallelism: 1,
            delay: "10s",
            failure_action: "rollback",
            order: "start-first",
          },
          restart_policy: {
            condition: "on-failure",
            delay: "5s",
            max_attempts: 3,
            window: "120s",
          },
        },
        secrets: specs.flatMap((s) => secretNames(s)),
      };
    }
    for (const spec of specs) {
      prodServices[spec.serviceName] = {
        deploy: {
          restart_policy: {
            condition: "on-failure",
            delay: "5s",
            max_attempts: 3,
            window: "120s",
          },
        },
        secrets: secretNames(spec),
      };
    }
    prodDoc = { services: prodServices };
    mergeLayers.push(prodDoc);
  }

  const merged = mergeLayers.reduce<Record<string, unknown>>(
    (acc, layer) => deepMergeCompose(acc, layer),
    {},
  );

  if (options.prod) {
    applyResourceBudget(merged, {
      cpus: options.serverCpus,
      memoryGb: options.serverMemoryGb,
    });
  }

  if (layout === "single") {
    files.push({ path: DOCKER_COMPOSE, content: formatComposeYaml(merged) });
    return {
      files,
      composeFiles: [DOCKER_COMPOSE, DOCKER_COMPOSE_OVERRIDE],
    };
  }

  if (layout === "stack") {
    files.push({ path: DOCKER_STACK, content: formatComposeYaml(merged) });
    return {
      files,
      composeFiles: [DOCKER_STACK],
    };
  }

  // split — layered files + optional prod overlay; override never written
  files.push({ path: COMPOSE_BASE, content: formatComposeYaml(base) });
  for (const { role, doc } of roleDocs) {
    files.push({ path: `compose.${role}.yml`, content: formatComposeYaml(doc) });
  }
  if (prodDoc) {
    // Re-emit prod overlay with budgeted resources so `-f` merge matches single.
    const budgetedProd = budgetProdOverlay(prodDoc, merged);
    files.push({
      path: "compose.prod.yml",
      content: formatComposeYaml(budgetedProd),
    });
  }
  return {
    files,
    composeFiles: [
      COMPOSE_BASE,
      ...specs.map((s) => `compose.${s.role}.yml`),
      ...(prodDoc ? ["compose.prod.yml"] : []),
      COMPOSE_OVERRIDE,
    ],
  };
}

/**
 * Write budgeted `deploy.resources` onto every service in a merged compose doc.
 *
 * @param doc - Merged compose document (mutated)
 * @param budget - Host capacity
 */
function applyResourceBudget(doc: Record<string, unknown>, budget: Partial<ServerBudget>): void {
  const services = doc.services;
  if (!isPlainObject(services)) return;
  const names = Object.keys(services);
  const limits = allocateServiceResources(names, budget);
  for (const name of names) {
    const limit = limits.get(name);
    if (!limit) continue;
    const svc = services[name];
    if (!isPlainObject(svc)) continue;
    const existingDeploy = isPlainObject(svc.deploy) ? svc.deploy : undefined;
    svc.deploy = mergeDeployResources(limit, existingDeploy);
  }
}

/**
 * Copy budgeted `deploy.resources` from the merged doc onto the prod overlay
 * so split `-f` merges stay aligned with the single-file output.
 *
 * @param prodDoc - Prod overlay before budgeting
 * @param merged - Fully merged (already budgeted) document
 */
function budgetProdOverlay(
  prodDoc: Record<string, unknown>,
  merged: Record<string, unknown>,
): Record<string, unknown> {
  const out = deepMergeCompose({}, prodDoc);
  const outServices = out.services;
  const mergedServices = merged.services;
  if (!isPlainObject(outServices) || !isPlainObject(mergedServices)) return out;
  for (const [name, svc] of Object.entries(outServices)) {
    if (!isPlainObject(svc)) continue;
    const mergedSvc = mergedServices[name];
    if (!isPlainObject(mergedSvc) || !isPlainObject(mergedSvc.deploy)) continue;
    const mergedDeploy = mergedSvc.deploy;
    const prevDeploy = isPlainObject(svc.deploy) ? svc.deploy : {};
    svc.deploy = deepMergeCompose({ ...prevDeploy }, { ...mergedDeploy });
  }
  return out;
}

/**
 * Deep-merge compose documents the way Docker Compose merges `-f` overlays:
 * maps recurse; sequences and scalars from the later document replace earlier.
 *
 * @param base - Earlier layer
 * @param overlay - Later layer
 */
export function deepMergeCompose(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const prev = out[key];
    if (isPlainObject(prev) && isPlainObject(value)) {
      out[key] = deepMergeCompose(prev, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Build docker env key/value map (credentials + connection URLs).
 *
 * @param specs - Services
 * @param recipes - Extra recipes
 * @param host - Hostname for URL builders
 */
export function buildStackEnv(
  specs: readonly ServiceSpec[],
  recipes: readonly ImageRecipe[] = [],
  host = "127.0.0.1",
  controls: Readonly<Record<string, string>> = {},
  instanceId?: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const spec of specs) {
    const prefix = envPrefix(spec.role);
    const recipe = recipeFor(spec.image, recipes);
    const url = recipe.url(spec, {
      host,
      port: spec.hostPort,
      user: spec.credentials.user,
      password: spec.credentials.password,
      database: spec.credentials.database,
    });
    const applied = recipe.apply(spec);
    const uiExtra = applied.extraPorts?.[0];
    const uiHost =
      uiExtra === undefined
        ? undefined
        : instanceId
          ? extraHostPortForInstance(spec.role, uiExtra.host, instanceId)
          : uiExtra.host;
    if (spec.role === "store.sql") {
      env[`${prefix}_USER`] = spec.credentials.user;
      env[`${prefix}_PASSWORD`] = spec.credentials.password;
      env[`${prefix}_DB`] = spec.credentials.database;
      env[`${prefix}_URL`] = url;
      env.DATABASE_URL = url;
    } else if (spec.role === "pgdog") {
      // URL uses store.sql credentials (same user/db the pooler proxies).
      const sql = specs.find((s) => s.role === "store.sql");
      const creds = sql?.credentials ?? spec.credentials;
      const poolUrl = recipe.url(spec, {
        host,
        port: spec.hostPort,
        user: creds.user,
        password: creds.password,
        database: creds.database,
      });
      env[`${prefix}_URL`] = poolUrl;
      env.OKE_PGDOG_URL = poolUrl;
    } else if (spec.role === "store.kv") {
      env[`${prefix}_PASSWORD`] = spec.credentials.password;
      env[`${prefix}_URL`] = url;
      env.REDIS_URL = url;
    } else if (spec.role === "store.files") {
      env[`${prefix}_URL`] = url;
      env.S3_ACCESS_KEY_ID = spec.credentials.user;
      env.S3_SECRET_ACCESS_KEY = spec.credentials.password;
      env.S3_BUCKET = spec.credentials.database;
      env.S3_URL = url;
      env.S3_ENDPOINT = new URL(url).origin;
      env.S3_REGION = "us-east-1";
      if (uiHost !== undefined) env.S3_CONSOLE_URL = `http://${host}:${uiHost}`;
    } else if (spec.role === "channel.email") {
      env[`${prefix}_URL`] = url;
      env.SMTP_URL = url;
      env.SMTP_HOST = host;
      env.SMTP_PORT = String(spec.hostPort);
      if (uiHost !== undefined) env.MAILPIT_UI_URL = `http://${host}:${uiHost}`;
    } else if (spec.role === "store.index") {
      // Meilisearch: standalone HTTP URL + the generated master key.
      env[`${prefix}_URL`] = url;
      env.OKE_STORE_INDEX_URL = url;
      env.OKE_STORE_INDEX_KEY = spec.credentials.password;
    } else if (spec.role === "ai") {
      // Ollama: standalone HTTP URL; model is a stack control (OKE_AI_MODEL).
      env[`${prefix}_URL`] = url;
      env.OKE_AI_URL = url;
    } else if (spec.role === "proxy") {
      // Edge TLS terminator — host is the public URL, not a driver DSN.
      env[`${prefix}_URL`] = url;
      env.OKE_PROXY_URL = url;
    } else {
      env[`${prefix}_USER`] = spec.credentials.user;
      env[`${prefix}_PASSWORD`] = spec.credentials.password;
      env[`${prefix}_DB`] = spec.credentials.database;
      env[`${prefix}_URL`] = url;
    }
  }
  // When PgDog sits in front of Postgres, apps talk to the pooler — wire-protocol
  // transparent; zero application changes (Bun.SQL / Drizzle / any Postgres client).
  const sqlSpec = specs.find((s) => s.role === "store.sql");
  const pgdogSpec = specs.find((s) => s.role === "pgdog");
  if (sqlSpec && pgdogSpec) {
    const poolRecipe = recipeFor(pgdogSpec.image, recipes);
    env.DATABASE_URL = poolRecipe.url(pgdogSpec, {
      host,
      port: pgdogSpec.hostPort,
      user: sqlSpec.credentials.user,
      password: sqlSpec.credentials.password,
      database: sqlSpec.credentials.database,
    });
  }

  for (const key of STACK_CONTROL_KEYS) {
    const value = controls[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/** Friendly section titles for known compose roles. */
const ROLE_SECTION_TITLE: Readonly<Record<string, string>> = {
  "store.sql": "store.sql — Postgres",
  pgdog: "pgdog — connection pooler (in front of Postgres)",
  "store.kv": "store.kv — Redis",
  "store.files": "store.files — object storage (S3)",
  "store.index": "store.index — search index",
  "channel.email": "channel.email — Mailpit (SMTP + UI)",
  signal: "signal — message bus",
  ai: "ai — local inference (llama.cpp / Ollama / vLLM / SGLang)",
  proxy: "proxy — edge reverse proxy (Caddy / Traefik / nginx)",
};

/**
 * Serialise a compose mapping with section gaps and per-service comments.
 *
 * @param doc - Merged or layered compose document
 */
function formatComposeYaml(doc: Record<string, unknown>): string {
  return composeToYaml(doc, { serviceComment: commentForComposeService });
}

/**
 * Human-readable comment for a compose service key.
 *
 * @param serviceName - Compose service name (`store-sql`, `app`, …)
 */
function commentForComposeService(serviceName: string): string {
  if (serviceName === "app") return "App — okengine runtime";
  if (serviceName === "socket-proxy") return "Docker socket proxy (Traefik companion)";
  const role = serviceName.replaceAll("-", ".");
  return ROLE_SECTION_TITLE[role] ?? role;
}

/** Friendly aliases emitted beside their role block. */
const ROLE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "store.sql": ["DATABASE_URL", "PGDATA", "POSTGRES_INITDB_ARGS"],
  // OKE_PGDOG_URL is already emitted as `${prefix}_URL`.
  pgdog: [],
  "store.kv": ["REDIS_URL", "OKE_STORE_KV_MAXMEMORY", "OKE_STORE_KV_MAXMEMORY_POLICY"],
  "store.files": [
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_BUCKET",
    "S3_URL",
    "S3_ENDPOINT",
    "S3_CONSOLE_URL",
    "S3_REGION",
    "S3_SESSION_TOKEN",
  ],
  "channel.email": [
    "SMTP_URL",
    "SMTP_HOST",
    "SMTP_PORT",
    "MAILPIT_UI_URL",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "MP_MAX_MESSAGES",
    "MP_SMTP_AUTH_ACCEPT_ANY",
    "MP_SMTP_AUTH_ALLOW_INSECURE",
  ],
  // OKE_AI_URL is already emitted as `${prefix}_URL` — do not alias it again.
  ai: ["OKE_AI_MODEL", "OKE_AI_CTX_SIZE"],
  proxy: ["OKE_PROXY_HOST", "OKE_PROXY_ACME_EMAIL"],
  "store.index": ["OKE_STORE_INDEX_KEY"],
};

/** Optional controls documented in `.env.local` and preserved on regeneration. */
const ROLE_CONTROL_EXAMPLES: Readonly<Record<string, readonly string[]>> = {
  "store.sql": ["PGDATA=/var/lib/postgresql/data/pgdata", "POSTGRES_INITDB_ARGS=--data-checksums"],
  "store.kv": ["OKE_STORE_KV_MAXMEMORY=256mb", "OKE_STORE_KV_MAXMEMORY_POLICY=allkeys-lru"],
  "store.files": ["S3_SESSION_TOKEN="],
  "channel.email": [
    "SMTP_USER=",
    "SMTP_PASSWORD=",
    "MP_MAX_MESSAGES=500",
    "MP_SMTP_AUTH_ACCEPT_ANY=1",
    "MP_SMTP_AUTH_ALLOW_INSECURE=1",
  ],
  // Curated Docker Hub `ai/` model id for llama.cpp; Ollama tags differ.
  // OKE_AI_CTX_SIZE bounds the KV cache llama-server allocates at load —
  // left at the model's full native context (often 32K-256K+), a small
  // model's KV cache alone can OOM the container regardless of host RAM.
  ai: ["OKE_AI_MODEL=granite3.3:2b", "OKE_AI_CTX_SIZE=4096"],
  proxy: ["OKE_PROXY_HOST=localhost", "OKE_PROXY_ACME_EMAIL=admin@example.com"],
};

/**
 * Infer role from an `OKE_<ROLE>_*` key (`OKE_STORE_SQL_URL` → `store.sql`).
 *
 * @param key - Env key
 */
function roleFromEnvKey(key: string): string | undefined {
  const m = /^OKE_(.+)_(USER|PASSWORD|DB|URL)$/.exec(key);
  if (m) return m[1]!.toLowerCase().replaceAll("_", ".");
  if (key.startsWith("S3_")) return "store.files";
  if (key.startsWith("SMTP_") || key.startsWith("MP_") || key === "MAILPIT_UI_URL") {
    return "channel.email";
  }
  if (key === "PGDATA" || key === "POSTGRES_INITDB_ARGS") return "store.sql";
  if (key.startsWith("OKE_STORE_KV_MAXMEMORY")) return "store.kv";
  if (
    key === "OKE_AI_URL" ||
    key === "OKE_AI_MODEL" ||
    key === "OKE_AI_CTX_SIZE" ||
    key === "OLLAMA_HOST"
  ) {
    return "ai";
  }
  if (key === "OKE_PROXY_URL" || key === "OKE_PROXY_HOST" || key === "OKE_PROXY_ACME_EMAIL") {
    return "proxy";
  }
  if (key === "OKE_STORE_INDEX_KEY" || key === "OKE_STORE_INDEX_URL") return "store.index";
  return undefined;
}

/**
 * Serialise stack env to commented, role-grouped dotenv text.
 *
 * @param env - Key/value map from {@link buildStackEnv}
 */
export function formatStackEnv(env: Readonly<Record<string, string>>): string {
  const roles = new Set<string>();
  for (const key of Object.keys(env)) {
    const role = roleFromEnvKey(key);
    if (role) roles.add(role);
  }
  const ordered = [...roles].sort((a, b) => a.localeCompare(b));
  const used = new Set<string>();
  const lines: string[] = [
    "# .env.local — stack keys written by `oke dev --docker`",
    "# Credentials + connection URLs for the local compose stack.",
    "# Host ports are unique per project (instance offset). Do not commit.",
    "# Vault resolution: driver → process.env → .env.local → dev-fallback",
    "#",
    "# Re-run `oke dev --docker` to regenerate. Put compose tweaks in",
    "# docker-compose.override.yml (or compose.override.yml for --split) — never put secrets in YAML.",
    "",
  ];

  for (const role of ordered) {
    const prefix = envPrefix(role);
    const title = ROLE_SECTION_TITLE[role] ?? role;
    lines.push(`# ── ${title} ${"─".repeat(Math.max(4, 56 - title.length))}`);
    for (const key of [`${prefix}_USER`, `${prefix}_PASSWORD`, `${prefix}_DB`, `${prefix}_URL`]) {
      const value = env[key];
      if (value === undefined) continue;
      lines.push(`${key}=${escapeEnv(value)}`);
      used.add(key);
    }
    for (const alias of ROLE_ALIASES[role] ?? []) {
      const value = env[alias];
      if (value === undefined) continue;
      lines.push(`${alias}=${escapeEnv(value)}`);
      used.add(alias);
    }
    const controls = ROLE_CONTROL_EXAMPLES[role] ?? [];
    const inactive = controls.filter(
      (example) => env[example.slice(0, example.indexOf("="))] === undefined,
    );
    if (inactive.length > 0) {
      lines.push("# Optional controls (uncomment to override; preserved on regeneration):");
      for (const example of inactive) lines.push(`# ${example}`);
    }
    lines.push("");
  }

  const leftover = Object.keys(env)
    .filter((k) => !used.has(k))
    .sort((a, b) => a.localeCompare(b));
  if (leftover.length > 0) {
    lines.push(`# ── other ${"─".repeat(50)}`);
    for (const key of leftover) {
      lines.push(`${key}=${escapeEnv(env[key]!)}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Assert generated YAML contains no cleartext credential values.
 *
 * @param yaml - File content
 * @param credentials - Values that must not appear
 */
export function assertNoCredentialsInYaml(
  yaml: string,
  credentials: Iterable<ServiceCredentials>,
): void {
  for (const c of credentials) {
    if (yaml.includes(c.password)) {
      throw new Error("oke docker: credential leaked into generated YAML");
    }
  }
}

function secretNames(spec: ServiceSpec): string[] {
  const p = envPrefix(spec.role);
  return [`${p}_PASSWORD`];
}

/**
 * Collect named volume declarations from recipe volume mounts (`name:/path`).
 *
 * @param volumes - Compose volume strings
 */
function namedVolumeDecls(
  volumes: readonly string[] | undefined,
): Record<string, Record<string, never>> {
  const out: Record<string, Record<string, never>> = {};
  for (const v of volumes ?? []) {
    if (v.startsWith(".") || v.startsWith("/") || v.startsWith("~")) continue;
    const name = v.split(":")[0];
    if (name) out[name] = {};
  }
  return out;
}

/**
 * Recipe extra services, minus peer overlays that only exist when `app` is
 * in the stack (Traefik routing labels). A label-only `app` with no image
 * or build is invalid Compose — `oke dev` is infra-only (`includeApp: false`).
 *
 * @param services - Extra compose service fragments from a recipe
 * @param includeApp - Whether the stack includes the `app` service
 */
function peerServices(
  services: Readonly<Record<string, Record<string, unknown>>> | undefined,
  includeApp: boolean,
): Record<string, Record<string, unknown>> {
  const extra = { ...(services ?? {}) };
  if (!includeApp) delete extra.app;
  return extra;
}

/**
 * Volume mounts declared on companion services from {@link RecipeApplyResult.services}.
 *
 * @param services - Extra compose service fragments
 */
function extraServiceVolumes(
  services: Readonly<Record<string, Record<string, unknown>>> | undefined,
): string[] {
  const out: string[] = [];
  for (const svc of Object.values(services ?? {})) {
    const vols = svc.volumes;
    if (!Array.isArray(vols)) continue;
    for (const v of vols) {
      if (typeof v === "string") out.push(v);
    }
  }
  return out;
}

function escapeEnv(value: string): string {
  if (/[\s#"'$\\]/.test(value)) {
    return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  }
  return value;
}
