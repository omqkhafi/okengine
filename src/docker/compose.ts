/**
 * Four compose override layers ending in an untouched `compose.override.yml`.
 *
 * 1. `compose.yml`            — app + network (generated)
 * 2. `compose.<role>.yml`     — per-role services (generated)
 * 3. `compose.prod.yml`       — prod overlays (generated when `--prod`)
 * 4. `compose.override.yml`   — user-owned; oke never writes it
 */

import { defaultHostPort, envPrefix, serviceNameFor, toYaml } from "./helpers.ts";
import { recipeFor } from "./recipes/index.ts";
import type {
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

/** Canonical layer-4 filename — never written by derivation. */
export const COMPOSE_OVERRIDE = "compose.override.yml";

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
    envFile: ".env.docker",
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
 * Emit compose layers 1–3 (+ Dockerfile companion handled elsewhere).
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
  const paths = composePathRefs(options.composeDir ?? DEFAULT_DOCKER_DIR);
  const files: GeneratedFile[] = [];

  // Layer 1 — project name + network (+ optional app for deploy / oke docker)
  const base: Record<string, unknown> = {
    name: `oke-${app}`,
    networks: { oke: { driver: "bridge" } },
  };
  if (includeApp) {
    base.services = {
      app: {
        build: {
          context: paths.buildContext,
          dockerfile: paths.dockerfile,
        },
        ports: [`${appPort}:${appPort}`],
        env_file: [paths.envFile],
        depends_on: Object.fromEntries(
          specs.map((s) => [s.serviceName, { condition: "service_healthy" }]),
        ),
        networks: ["oke"],
      },
    };
  }
  files.push({ path: "compose.yml", content: `${toYaml(base)}\n` });

  // Layer 2 — per-role
  for (const spec of specs) {
    const recipe = recipeFor(spec.image, recipes);
    const applied = recipe.apply(spec);
    const ports = [
      `${spec.hostPort}:${spec.port}`,
      ...(applied.extraPorts ?? []).map((p) => {
        const hostPort = options.instanceId
          ? extraHostPortForInstance(spec.role, p.host, options.instanceId)
          : p.host;
        return `${hostPort}:${p.container}`;
      }),
    ];
    const service: Record<string, unknown> = {
      image: spec.image,
      ports,
      networks: ["oke"],
      env_file: [paths.envFile],
    };
    if (applied.environment) service.environment = applied.environment;
    if (applied.command) service.command = applied.command;
    if (applied.entrypoint) service.entrypoint = applied.entrypoint;
    if (applied.healthcheck) service.healthcheck = applied.healthcheck;
    if (applied.volumes) service.volumes = applied.volumes;
    if (applied.user) service.user = applied.user;

    const namedVolumes = namedVolumeDecls(applied.volumes);
    const doc: Record<string, unknown> = {
      services: { [spec.serviceName]: service },
      networks: { oke: { external: false } },
    };
    if (Object.keys(namedVolumes).length > 0) {
      doc.volumes = namedVolumes;
    }
    const path = `compose.${spec.role}.yml`;
    files.push({ path, content: `${toYaml(doc)}\n` });
  }

  // Layer 3 — prod overlay
  if (options.prod) {
    const prodServices: Record<string, unknown> = {};
    if (includeApp) {
      prodServices.app = {
        deploy: {
          replicas: 1,
          resources: {
            limits: { cpus: "1.0", memory: "512M" },
          },
        },
        secrets: specs.flatMap((s) => secretNames(s)),
      };
    }
    for (const spec of specs) {
      prodServices[spec.serviceName] = {
        deploy: {
          resources: {
            limits: { cpus: "1.0", memory: "512M" },
          },
        },
        secrets: secretNames(spec),
      };
    }
    files.push({
      path: "compose.prod.yml",
      content: `${toYaml({ services: prodServices })}\n`,
    });
  }

  // Layer 4 — never written. Document merge order only.
  const composeFiles = [
    "compose.yml",
    ...specs.map((s) => `compose.${s.role}.yml`),
    ...(options.prod ? ["compose.prod.yml"] : []),
    COMPOSE_OVERRIDE,
  ];

  return { files, composeFiles };
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
    } else if (spec.role === "vault") {
      // Token is minted by the bootstrap — never a generated password here.
      env[`${prefix}_URL`] = url;
      env.OKE_VAULT_URL = url;
    } else if (spec.role === "store.index") {
      // Meilisearch: standalone HTTP URL + the generated master key.
      env[`${prefix}_URL`] = url;
      env.OKE_STORE_INDEX_URL = url;
      env.OKE_STORE_INDEX_KEY = spec.credentials.password;
    } else {
      env[`${prefix}_USER`] = spec.credentials.user;
      env[`${prefix}_PASSWORD`] = spec.credentials.password;
      env[`${prefix}_DB`] = spec.credentials.database;
      env[`${prefix}_URL`] = url;
    }
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
  "store.kv": "store.kv — Redis",
  "store.files": "store.files — object storage (S3)",
  "store.index": "store.index — search index",
  "channel.email": "channel.email — Mailpit (SMTP + UI)",
  signal: "signal — message bus",
  vault: "vault — OpenBao",
};

/** Friendly aliases emitted beside their role block. */
const ROLE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "store.sql": ["DATABASE_URL", "PGDATA", "POSTGRES_INITDB_ARGS"],
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
};

/** Optional controls documented in `.env.docker` and preserved on regeneration. */
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
    "# docker/.env.docker — generated by `oke dev --docker`",
    "# Credentials + connection URLs for the local compose stack.",
    "# Host ports are unique per project (instance offset). Do not commit.",
    "# Vault resolution: process.env → .env.local → docker/.env.docker → driver",
    "#",
    "# Re-run `oke dev --docker` to regenerate. Put compose tweaks in",
    "# compose.override.yml — never put secrets in YAML.",
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

function escapeEnv(value: string): string {
  if (/[\s#"'$\\]/.test(value)) {
    return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  }
  return value;
}
