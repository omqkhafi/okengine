/**
 * Derive Dockerfile + compose files from config image pins.
 */

import { mkdirSync } from "node:fs";
import {
  assertNoCredentialsInYaml,
  buildSpecs,
  buildStackEnv,
  emitComposeLayers,
  formatStackEnv,
} from "./compose.ts";
import { emitDockerfile } from "./dockerfile.ts";
import { buildCaddyfile } from "./recipes/caddy.ts";
import { buildPgDogToml, buildPgDogUsersToml } from "./recipes/pgdog.ts";
import type { DeriveOptions, DeriveResult, GeneratedFile } from "./types.ts";
import { DEFAULT_DOCKER_DIR } from "./types.ts";
import { APP_PORT } from "../runtime/types.ts";

/**
 * Derive infrastructure files from normalised image pins.
 *
 * Credentials land only in the returned `stackEnv` (for `.env.docker`) and
 * in `users.toml` when PgDog is present — never in generated YAML. Layer 4
 * (`compose.override.yml`) is listed in `composeFiles` but never written.
 *
 * @param options - Images / app / prod flag
 */
export function deriveInfrastructure(options: DeriveOptions): DeriveResult {
  if (!options.images || Object.keys(options.images).length === 0) {
    throw new Error(
      "oke docker: no images configured — set `images` in oke.config.ts (or prod drivers postgres/redis for defaults)",
    );
  }

  const normalised: DeriveOptions = {
    ...options,
    composeDir: options.composeDir ?? DEFAULT_DOCKER_DIR,
    includeApp: options.includeApp !== false,
  };

  const specs = buildSpecs(normalised);
  const { files: composeFilesContent, composeFiles } = emitComposeLayers(specs, normalised);
  const dockerfile: GeneratedFile = {
    path: "Dockerfile",
    content: emitDockerfile({ appPort: normalised.appPort }),
  };
  // Always emit Dockerfile for deploy; stack-only runs ignore it.
  const files = [
    dockerfile,
    ...composeFilesContent,
    ...pgdogConfigFiles(specs),
    ...proxyConfigFiles(specs, normalised.appPort),
  ];

  for (const f of files) {
    if (f.path.endsWith(".yml") || f.path === "Dockerfile") {
      assertNoCredentialsInYaml(
        f.content,
        specs.map((s) => s.credentials),
      );
    }
  }

  const stackEnv = buildStackEnv(
    specs,
    normalised.recipes ?? [],
    normalised.host ?? "127.0.0.1",
    normalised.controls,
    normalised.instanceId,
  );

  return { specs, files, stackEnv, composeFiles };
}

/**
 * Emit PgDog TOML configs when both `pgdog` and `store.sql` are in the stack.
 *
 * `pgdog.toml` has no secrets; `users.toml` mirrors store.sql credentials
 * (same trust boundary as `.env.docker` — do not commit).
 *
 * @param specs - Normalised services
 */
function pgdogConfigFiles(specs: DeriveResult["specs"]): GeneratedFile[] {
  const sql = specs.find((s) => s.role === "store.sql");
  const pooler = specs.find((s) => s.role === "pgdog");
  if (!sql || !pooler) return [];
  return [
    {
      path: "pgdog.toml",
      content: buildPgDogToml({ database: sql.credentials.database }),
    },
    {
      path: "users.toml",
      content: buildPgDogUsersToml({
        user: sql.credentials.user,
        password: sql.credentials.password,
        database: sql.credentials.database,
      }),
    },
  ];
}

/**
 * Emit proxy companion configs when `images.proxy` is pinned.
 *
 * Caddy gets a generated `Caddyfile`. Traefik configures via Docker labels
 * (no companion file).
 *
 * @param specs - Normalised services
 * @param appPort - App listen port (default 6530)
 */
function proxyConfigFiles(
  specs: DeriveResult["specs"],
  appPort: number | undefined,
): GeneratedFile[] {
  const proxy = specs.find((s) => s.role === "proxy");
  if (!proxy) return [];
  if (/caddy/i.test(proxy.image)) {
    return [{ path: "Caddyfile", content: buildCaddyfile({ appPort: appPort ?? APP_PORT }) }];
  }
  return [];
}

/**
 * Write derived files to disk. Never writes `compose.override.yml` or
 * credential values into YAML. Optionally writes `docker/.env.docker`.
 *
 * @param result - Derive result
 * @param outDir - Destination for Dockerfile / compose (usually `docker/`)
 * @param options - Write controls
 */
export async function writeDerivedFiles(
  result: DeriveResult,
  outDir: string,
  options: {
    readonly writeStackEnv?: boolean;
  } = {},
): Promise<readonly string[]> {
  const written: string[] = [];
  const root = outDir.replace(/\/$/, "");
  mkdirSync(root, { recursive: true });
  for (const file of result.files) {
    const path = `${root}/${file.path}`;
    await Bun.write(path, file.content);
    written.push(path);
  }
  if (options.writeStackEnv) {
    const envPath = `${root}/.env.docker`;
    await Bun.write(envPath, formatStackEnv(result.stackEnv));
    written.push(envPath);
  }
  return written;
}
