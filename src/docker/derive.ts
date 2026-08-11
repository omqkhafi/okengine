/**
 * Derive Dockerfile + compose files from config image pins.
 */

import { mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  assertNoCredentialsInYaml,
  buildSpecs,
  buildStackEnv,
  COMPOSE_OVERRIDE,
  DOCKER_COMPOSE_OVERRIDE,
  emitComposeLayers,
  formatStackEnv,
} from "./compose.ts";
import { emitDockerfile } from "./dockerfile.ts";
import { buildCaddyfile } from "./recipes/caddy.ts";
import { buildNginxConf } from "./recipes/nginx.ts";
import {
  buildLlamaCppEntrypoint,
  LLAMA_CPP_ENTRYPOINT_FILE,
  LLAMA_CPP_ENTRYPOINT_HOST_PATH,
  llamaCpp,
} from "./recipes/llama-cpp.ts";
import { buildPgDogToml, buildPgDogUsersToml, PGDOG_CONFIG_DIR } from "./recipes/pgdog.ts";
import type { DeriveOptions, DeriveResult, GeneratedFile } from "./types.ts";
import { DEFAULT_DOCKER_DIR } from "./types.ts";
import { APP_PORT } from "../runtime/types.ts";

/**
 * Derive infrastructure files from normalised image pins.
 *
 * Credentials land only in the returned `stackEnv` (for `.env.docker`) and
 * in `pgdog/users.toml` when PgDog is present — never in generated YAML.
 * User-owned overrides are listed in `composeFiles` but never written.
 *
 * @param options - Images / app / prod / layout flags
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
    layout: options.layout ?? "single",
  };

  const specs = buildSpecs(normalised);
  const { files: composeFilesContent, composeFiles } = emitComposeLayers(specs, normalised);
  const dockerfile: GeneratedFile = {
    path: "Dockerfile",
    content: emitDockerfile({ appPort: normalised.appPort }),
  };
  const stackEnv = buildStackEnv(
    specs,
    normalised.recipes ?? [],
    normalised.host ?? "127.0.0.1",
    normalised.controls,
    normalised.instanceId,
  );

  // Always emit Dockerfile for deploy; stack-only runs ignore it.
  const files = [
    dockerfile,
    ...composeFilesContent,
    ...pgdogConfigFiles(specs),
    ...proxyConfigFiles(specs, normalised.appPort),
    ...llamaCppEntrypointFiles(specs),
  ];

  for (const f of files) {
    if (f.path.endsWith(".yml") || f.path === "Dockerfile") {
      assertNoCredentialsInYaml(
        f.content,
        specs.map((s) => s.credentials),
      );
    }
  }

  return { specs, files, stackEnv, composeFiles };
}

/**
 * Emit `.oke/llama-entrypoint.py` (path relative to compose dir) when the AI
 * role is llama.cpp so first boot can Hub-pull then serve single-model
 * (router `--docker-repo` hangs on b10290+). Kept out of `docker/` so app
 * trees stay TypeScript-only.
 *
 * @param specs - Normalised services
 */
function llamaCppEntrypointFiles(specs: DeriveResult["specs"]): GeneratedFile[] {
  const ai = specs.find((s) => s.role === "ai");
  if (!ai || !llamaCpp.match(ai.image)) return [];
  return [
    {
      path: LLAMA_CPP_ENTRYPOINT_HOST_PATH,
      content: buildLlamaCppEntrypoint(),
    },
  ];
}

/**
 * Emit PgDog TOML configs when both `pgdog` and `store.sql` are in the stack.
 *
 * `pgdog/pgdog.toml` has no secrets; `pgdog/users.toml` mirrors store.sql
 * credentials (same trust boundary as `.env.docker` — do not commit).
 *
 * @param specs - Normalised services
 */
function pgdogConfigFiles(specs: DeriveResult["specs"]): GeneratedFile[] {
  const sql = specs.find((s) => s.role === "store.sql");
  const pooler = specs.find((s) => s.role === "pgdog");
  if (!sql || !pooler) return [];
  return [
    {
      path: `${PGDOG_CONFIG_DIR}/pgdog.toml`,
      content: buildPgDogToml({
        database: sql.credentials.database,
        postgresPort: sql.port,
      }),
    },
    {
      path: `${PGDOG_CONFIG_DIR}/users.toml`,
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
 * Caddy gets a generated `Caddyfile`. nginx gets `nginx.conf`. Traefik
 * configures via Docker labels (no companion file).
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
  const port = appPort ?? APP_PORT;
  if (/caddy/i.test(proxy.image)) {
    return [{ path: "Caddyfile", content: buildCaddyfile({ appPort: port }) }];
  }
  if (/nginx/i.test(proxy.image)) {
    return [{ path: "nginx.conf", content: buildNginxConf({ appPort: port }) }];
  }
  return [];
}

/**
 * Write derived files to disk. Never writes user overrides or credential
 * values into YAML. Prunes stale generated compose / PgDog artefacts from a
 * previous layout. Optionally writes `docker/.env.docker`.
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
  const keep = new Set(result.files.map((f) => f.path));
  pruneStaleGenerated(root, keep);
  pruneLlamaEntrypoint(root, keep);
  for (const file of result.files) {
    const path = join(root, file.path);
    mkdirSync(dirname(path), { recursive: true });
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

/** Generated compose / companion paths safe to delete when absent from a derive. */
const PRUNE_ROOT_FILES = new Set([
  "Dockerfile",
  "docker-compose.yml",
  "docker-stack.yml",
  "compose.yml",
  "compose.all.yml",
  "compose.prod.yml",
  "Caddyfile",
  "nginx.conf",
  // Legacy: entrypoint used to land in `docker/`; now `.oke/` only.
  LLAMA_CPP_ENTRYPOINT_FILE,
  "pgdog.toml",
  "users.toml",
]);

/**
 * Drop `.oke/llama-entrypoint.py` when the stack no longer uses llama.cpp.
 *
 * @param root - Compose directory (`docker/`)
 * @param keep - Relative paths that will be rewritten
 */
function pruneLlamaEntrypoint(root: string, keep: ReadonlySet<string>): void {
  if (keep.has(LLAMA_CPP_ENTRYPOINT_HOST_PATH)) return;
  const abs = join(root, LLAMA_CPP_ENTRYPOINT_HOST_PATH);
  try {
    unlinkSync(abs);
  } catch {
    // absent or not a file
  }
}

/**
 * Remove previously generated artefacts that the current layout no longer emits.
 * Never touches user overrides or `.env.docker`.
 *
 * @param root - Compose directory
 * @param keep - Relative paths that will be rewritten
 */
function pruneStaleGenerated(root: string, keep: ReadonlySet<string>): void {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === COMPOSE_OVERRIDE || name === DOCKER_COMPOSE_OVERRIDE) continue;
    if (name === ".env.docker") continue;
    const abs = join(root, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === PGDOG_CONFIG_DIR) {
        prunePgDogDir(abs, keep);
      }
      continue;
    }
    if (!st.isFile()) continue;
    const rel = name;
    if (keep.has(rel)) continue;
    if (PRUNE_ROOT_FILES.has(name) || /^compose\..+\.yml$/.test(name)) {
      try {
        unlinkSync(abs);
      } catch {
        // best-effort
      }
    }
  }
}

/**
 * Drop legacy / unused files under `pgdog/`.
 *
 * @param dir - Absolute `pgdog/` path
 * @param keep - Relative keep set (`pgdog/…`)
 */
function prunePgDogDir(dir: string, keep: ReadonlySet<string>): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const rel = `${PGDOG_CONFIG_DIR}/${name}`;
    if (keep.has(rel)) continue;
    try {
      unlinkSync(join(dir, name));
    } catch {
      // best-effort
    }
  }
  try {
    if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}
