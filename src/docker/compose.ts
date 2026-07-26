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
import { hostPortForInstance } from "./stack-id.ts";
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
    envFile: flat ? ".env.stack" : "../.env.stack",
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
  for (const spec of specs) {
    const recipe = recipeFor(spec.image, recipes);
    const applied = recipe.apply(spec);
    const service: Record<string, unknown> = {
      image: spec.image,
      ports: [`${spec.hostPort}:${spec.port}`],
      networks: ["oke"],
      env_file: [paths.envFile],
    };
    if (applied.environment) service.environment = applied.environment;
    if (applied.command) service.command = applied.command;
    if (applied.healthcheck) service.healthcheck = applied.healthcheck;
    if (applied.volumes) service.volumes = applied.volumes;
    if (applied.user) service.user = applied.user;

    const doc = {
      services: { [spec.serviceName]: service },
      networks: { oke: { external: false } },
    };
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
 * Build `.env.stack` key/value map (credentials + connection URLs).
 *
 * @param specs - Services
 * @param recipes - Extra recipes
 * @param host - Hostname for URL builders
 */
export function buildStackEnv(
  specs: readonly ServiceSpec[],
  recipes: readonly ImageRecipe[] = [],
  host = "127.0.0.1",
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const spec of specs) {
    const prefix = envPrefix(spec.role);
    env[`${prefix}_USER`] = spec.credentials.user;
    env[`${prefix}_PASSWORD`] = spec.credentials.password;
    env[`${prefix}_DB`] = spec.credentials.database;
    const recipe = recipeFor(spec.image, recipes);
    const url = recipe.url(spec, {
      host,
      port: spec.hostPort,
      user: spec.credentials.user,
      password: spec.credentials.password,
      database: spec.credentials.database,
    });
    env[`${prefix}_URL`] = url;
    // Friendly alias for the common sql role
    if (spec.role === "store.sql") env.DATABASE_URL = url;
    if (spec.role === "store.kv") env.REDIS_URL = url;
  }
  return env;
}

/**
 * Serialise stack env to dotenv text.
 *
 * @param env - Key/value map
 */
export function formatStackEnv(env: Readonly<Record<string, string>>): string {
  return (
    Object.entries(env)
      .map(([k, v]) => `${k}=${escapeEnv(v)}`)
      .join("\n") + "\n"
  );
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

function escapeEnv(value: string): string {
  if (/[\s#"'$\\]/.test(value)) {
    return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  }
  return value;
}
