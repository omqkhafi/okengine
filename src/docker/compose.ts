/**
 * Four compose override layers ending in an untouched `compose.override.yml`.
 *
 * 1. `compose.yml`            — app + network (generated)
 * 2. `compose.<role>.yml`     — per-role services (generated)
 * 3. `compose.prod.yml`       — prod overlays (generated when `--prod`)
 * 4. `compose.override.yml`   — user-owned; oke never writes it
 */

import {
  defaultHostPort,
  envPrefix,
  serviceNameFor,
  toYaml,
} from "./helpers.ts";
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
import { hostPortForInstance, instancePortOffset } from "./stack-id.ts";
import {
  ROLE_ALIAS_KEYS,
  ROLE_ENV_KEY_ORDER,
  ROLE_SECTION_TITLE,
  buildStackEnvMap,
  escapeEnv,
  roleFromEnvKey,
} from "./stack-env.ts";
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
    // Lives beside compose files (`docker/.env.docker` or project root when flat).
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
    const creds =
      options.credentials?.[role] ?? generateCredentials(role);
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
  const extraHostOffset = options.instanceId
    ? instancePortOffset(options.instanceId)
    : 0;
  for (const spec of specs) {
    const recipe = recipeFor(spec.image, recipes);
    const applied = recipe.apply(spec);
    const ports = [
      `${spec.hostPort}:${spec.port}`,
      ...(applied.extraPorts ?? []).map(
        (p) => `${p.host + extraHostOffset}:${p.container}`,
      ),
    ];
    const service: Record<string, unknown> = {
      image: spec.image,
      ports,
      networks: ["oke"],
      env_file: [paths.envFile],
    };
    if (applied.environment) service.environment = applied.environment;
    if (applied.command) service.command = applied.command;
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
 * Build `.env.docker` key/value map (credentials + connection URLs).
 *
 * Field names are recipe-accurate (Postgres USER/DB, Redis PASSWORD only,
 * S3 ACCESS_KEY/SECRET_KEY/BUCKET, Mailpit SMTP URL + UI — not a shared
 * USER/PASSWORD/DB template for every role).
 *
 * @param specs - Services
 * @param recipes - Extra recipes
 * @param host - Hostname for URL builders
 * @param extraPortOffset - Offset for Mailpit/RustFS UI host ports
 */
export function buildStackEnv(
  specs: readonly ServiceSpec[],
  recipes: readonly ImageRecipe[] = [],
  host = "127.0.0.1",
  extraPortOffset = 0,
): Record<string, string> {
  return buildStackEnvMap(specs, { host, recipes, extraPortOffset });
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
    for (const [r, aliases] of Object.entries(ROLE_ALIAS_KEYS)) {
      if (aliases.includes(key)) roles.add(r);
    }
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
    const title = ROLE_SECTION_TITLE[role] ?? role;
    lines.push(`# ── ${title} ${"─".repeat(Math.max(4, 56 - title.length))}`);
    const preferred = ROLE_ENV_KEY_ORDER[role] ?? [];
    const roleKeys = new Set<string>([
      ...preferred,
      ...Object.keys(env).filter((k) => roleFromEnvKey(k) === role),
      ...(ROLE_ALIAS_KEYS[role] ?? []),
    ]);
    const orderedKeys = [
      ...preferred.filter((k) => roleKeys.has(k) && env[k] !== undefined),
      ...[...roleKeys]
        .filter((k) => !preferred.includes(k) && env[k] !== undefined)
        .sort((a, b) => a.localeCompare(b)),
    ];
    for (const key of orderedKeys) {
      if (used.has(key)) continue;
      const value = env[key];
      if (value === undefined) continue;
      lines.push(`${key}=${escapeEnv(value)}`);
      used.add(key);
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
  if (spec.role === "channel.email") return [];
  if (spec.role === "store.files") return [`${p}_SECRET_KEY`];
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
