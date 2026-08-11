/**
 * Copy a template or example tree and apply the package.json transform.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveLocalOkengineRoot, resolveTemplateDir, type TemplateId } from "./templates.ts";
import { agentsMdContent } from "./agents-md.ts";
import type { CreateDefaults, CreateProxyId } from "./create-defaults.ts";
import { DEFAULT_IMAGES, TEMPLATE_DEV } from "./drivers-catalog.ts";
import { applyLocalesToProject } from "./locales.ts";
import {
  DEFAULT_SQL_DRIVER,
  applyCreateAnswers,
  applyPgDogToConfig,
  applyProxyToConfig,
  extractImages,
  sanitizeProjectName,
  shouldSkipTemplatePath,
  transformConfigForSqlDriver,
  transformPackageJson,
  resolveOkengineDependency,
  type ScaffoldPackageJson,
  type SqlDriverId,
} from "./transform.ts";

/** The bundled starter copied by the scaffold. */
export type ScaffoldSource = { readonly kind: "template"; readonly id: TemplateId };

/** Options for {@link scaffold}. */
export type ScaffoldOptions = {
  /** Destination directory (created). Absolute or cwd-relative. */
  readonly targetDir: string;
  /** npm package / folder name. */
  readonly name: string;
  /** Starter template source. */
  readonly source: ScaffoldSource;
  /** Write root `AGENTS.md` (default true). */
  readonly writeAgentsMd?: boolean;
  /**
   * Store SQL driver — pins `oke.config.ts` `store.sql` `dev`/`prod`
   * when set. Default `postgres` matches the Docker-first templates.
   * Ignored when {@link createDefaults} is set.
   */
  readonly sqlDriver?: SqlDriverId;
  /** Full customize / reuse answers — applied after copy. */
  readonly createDefaults?: CreateDefaults;
  /**
   * Extra locales beyond English. When omitted, uses
   * {@link CreateDefaults.locales} or English-only.
   */
  readonly locales?: readonly string[];
  /**
   * Pin PgDog in front of Postgres. When omitted, uses
   * {@link CreateDefaults.pgdog} or `false`.
   */
  readonly pgdog?: boolean;
  /**
   * Pin `images.proxy`. When omitted, uses {@link CreateDefaults.proxy} or
   * `none`.
   */
  readonly proxy?: CreateProxyId;
};

/** Result of a successful scaffold. */
export type ScaffoldResult = {
  readonly targetDir: string;
  readonly name: string;
  readonly source: ScaffoldSource;
  /** Display label (`standard`, `notes`, …). */
  readonly label: string;
  readonly okengineDependency: string;
  /** Store SQL driver applied to schema + config. */
  readonly sqlDriver: SqlDriverId;
  /** Customize answers applied, if any. */
  readonly createDefaults?: CreateDefaults;
  /** Extra locales applied beyond English. */
  readonly locales: readonly string[];
  /** Whether `images.pgdog` was pinned. */
  readonly pgdog: boolean;
  /** Proxy wizard id applied (`none` = unset). */
  readonly proxy: CreateProxyId;
  /** Relative paths written (POSIX), sorted. */
  readonly files: readonly string[];
};

/**
 * Why `targetDir` cannot host a new project, or `null` when it is free / empty.
 *
 * Used by the wizard (early name validation) and {@link scaffold}.
 *
 * @param targetDir - Absolute or cwd-relative destination
 */
export function targetDirectoryBlockReason(targetDir: string): string | null {
  const abs = resolve(targetDir);
  if (!existsSync(abs)) return null;
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return `create-oke: cannot read target directory: ${abs}`;
  }
  if (entries.length === 0) return null;
  const folder = basename(abs);
  return (
    `create-oke: "${folder}" already exists and is not empty (${abs}). ` +
    `Pick another name, or remove that directory first.`
  );
}

/**
 * Scaffold a new okengine project from the standard template.
 *
 * @param options - Name, source, destination
 */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const name = sanitizeProjectName(options.name);
  const targetDir = resolve(options.targetDir);
  const sourceDir = resolveTemplateDir(options.source.id);
  const label = options.source.id;
  const createDefaults = options.createDefaults;
  const sqlDriver =
    createDefaults?.drivers.store.sql.dev === "postgres" || options.sqlDriver === "postgres"
      ? "postgres"
      : (options.sqlDriver ?? DEFAULT_SQL_DRIVER);

  const blocked = targetDirectoryBlockReason(targetDir);
  if (blocked) throw new Error(blocked);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  try {
    const okengineDependency = resolveOkengineDependency(resolveLocalOkengineRoot());
    const written: string[] = [];

    copyTree(sourceDir, targetDir, "", written);

    const pkgPath = join(targetDir, "package.json");
    if (!existsSync(pkgPath)) {
      throw new Error(`create-oke: source "${label}" has no package.json`);
    }
    const sourcePkg = JSON.parse(readFileSync(pkgPath, "utf8")) as ScaffoldPackageJson;
    const nextPkg = transformPackageJson(sourcePkg, name, okengineDependency);
    writeFileSync(pkgPath, `${JSON.stringify(nextPkg, null, 2)}\n`, "utf8");

    if (createDefaults) {
      applyCreateDefaultsTransforms(targetDir, createDefaults);
    } else {
      applySqlDriverTransforms(targetDir, sqlDriver);
    }

    if (options.writeAgentsMd !== false) {
      const agentsPath = join(targetDir, "AGENTS.md");
      writeFileSync(agentsPath, agentsMdContent(name), "utf8");
      if (!written.includes("AGENTS.md")) written.push("AGENTS.md");
    }

    ensureVaultEnvNotes(targetDir, createDefaults?.drivers.vault.dev ?? TEMPLATE_DEV.vault);

    const envExample = join(targetDir, ".env.example");
    const envLocal = join(targetDir, ".env.local");
    if (existsSync(envExample) && !existsSync(envLocal)) {
      cpSync(envExample, envLocal);
      if (!written.includes(".env.local")) written.push(".env.local");
    }

    const locales = options.locales ?? createDefaults?.locales ?? [];
    for (const rel of applyLocalesToProject(targetDir, locales)) {
      if (!written.includes(rel) && existsSync(join(targetDir, rel))) written.push(rel);
      // Drop removed locale files from the written list when English-only.
      if (!existsSync(join(targetDir, rel))) {
        const i = written.indexOf(rel);
        if (i >= 0) written.splice(i, 1);
      }
    }

    const pgdog = options.pgdog ?? createDefaults?.pgdog ?? false;
    const proxy = options.proxy ?? createDefaults?.proxy ?? "none";
    const configPath = join(targetDir, "oke.config.ts");
    if (existsSync(configPath)) {
      let next = readFileSync(configPath, "utf8");
      next = applyPgDogToConfig(next, pgdog);
      next = applyProxyToConfig(next, proxy);
      const prev = readFileSync(configPath, "utf8");
      if (next !== prev) writeFileSync(configPath, next, "utf8");
    }

    const composeFiles = await writeScaffoldCompose(targetDir);
    for (const rel of composeFiles) {
      if (!written.includes(rel)) written.push(rel);
    }

    const systemSchema = await writeSystemSchema(targetDir);
    if (systemSchema && !written.includes(systemSchema)) written.push(systemSchema);

    written.sort();
    return {
      targetDir,
      name,
      source: options.source,
      label,
      okengineDependency,
      sqlDriver,
      ...(createDefaults !== undefined ? { createDefaults } : {}),
      locales,
      pgdog,
      proxy,
      files: written,
    };
  } catch (e) {
    rmSync(targetDir, { recursive: true, force: true });
    throw e;
  }
}

/**
 * For postgres, pin `store.sql` `dev`/`prod` in `oke.config.ts`.
 *
 * The default template already ships postgres for `dev`/`prod` — this is a
 * no-op unless customize changed the SQL driver and `--sql postgres` restores it.
 *
 * @param targetDir - Scaffolded project root
 * @param sqlDriver - Chosen store.sql driver
 */
function applySqlDriverTransforms(targetDir: string, sqlDriver: SqlDriverId): void {
  if (sqlDriver !== "postgres") return;

  const configPath = join(targetDir, "oke.config.ts");
  if (existsSync(configPath)) {
    const next = transformConfigForSqlDriver(readFileSync(configPath, "utf8"), sqlDriver);
    writeFileSync(configPath, next, "utf8");
  }
}

/** Marker that the built-in vault key note is already present. */
const VAULT_MASTER_KEY_MARKER = "OKE_VAULT_MASTER_KEY";

/**
 * Make sure `.env.example` explains the built-in vault's master key.
 *
 * Only the built-in `vault` backend has a key to hold: `env` reads the dotenv
 * layers directly, and `managed` gets credentials from the provider secret
 * store. The bundled templates already carry the note, so this only fires
 * for a template that dropped it.
 *
 * @param targetDir - Scaffolded project root
 * @param vaultDriver - Chosen `drivers.vault` dev pin
 */
function ensureVaultEnvNotes(targetDir: string, vaultDriver: string): void {
  if (vaultDriver !== "vault") return;
  const envExample = join(targetDir, ".env.example");
  if (!existsSync(envExample)) return;
  const source = readFileSync(envExample, "utf8");
  if (source.includes(VAULT_MASTER_KEY_MARKER)) return;
  writeFileSync(
    envExample,
    `${source.trimEnd()}\n
# ── vault — built-in encrypted-at-rest store ────────────────
# \`oke vault init\` prints the master key once; every later boot unseals with it.
# In production read it from your KMS instead of committing it here.
# OKE_VAULT_MASTER_KEY=
`,
    "utf8",
  );
}

/**
 * Apply full customize / reuse defaults to `oke.config.ts`.
 *
 * @param targetDir - Scaffolded project root
 * @param defaults - Persisted create answers
 */
function applyCreateDefaultsTransforms(targetDir: string, defaults: CreateDefaults): void {
  const configPath = join(targetDir, "oke.config.ts");
  if (!existsSync(configPath)) {
    throw new Error("create-oke: scaffolded project has no oke.config.ts");
  }
  const next = applyCreateAnswers(readFileSync(configPath, "utf8"), defaults);
  writeFileSync(configPath, next, "utf8");
}

/**
 * Emit `.oke/schema/oke.ts` (system / auth / plugin stubs) when the local
 * okengine source tree is available. Published create-oke regenerates after
 * `bun install` via `oke schema generate`.
 *
 * @param targetDir - Scaffolded project root
 * @returns Relative path written, or `undefined` when skipped
 */
async function writeSystemSchema(targetDir: string): Promise<string | undefined> {
  const okengineRoot = resolveLocalOkengineRoot();
  if (!okengineRoot) return undefined;
  try {
    const schemaUrl = pathToFileURL(join(okengineRoot, "src/cli/schema.ts")).href;
    const mod = (await import(schemaUrl)) as {
      runSchemaGenerate: (opts: {
        cwd?: string;
        write?: (text: string) => void;
      }) => Promise<number>;
      SCHEMA_OUT: string;
    };
    const code = await mod.runSchemaGenerate({ cwd: targetDir, write: () => {} });
    if (code !== 0) return undefined;
    return mod.SCHEMA_OUT;
  } catch {
    return undefined;
  }
}

/**
 * Derive `docker/docker-compose.yml` via okengine's {@link deriveInfrastructure}
 * when the monorepo root is available; otherwise write a minimal postgres+redis stub.
 *
 * @param targetDir - Scaffolded project root
 * @returns Relative docker paths written
 */
async function writeScaffoldCompose(targetDir: string): Promise<string[]> {
  const configPath = join(targetDir, "oke.config.ts");
  const images = existsSync(configPath)
    ? extractImages(readFileSync(configPath, "utf8"))
    : { ...DEFAULT_IMAGES };
  if (Object.keys(images).length === 0) {
    Object.assign(images, DEFAULT_IMAGES);
  }

  const okengineRoot = resolveLocalOkengineRoot();
  if (okengineRoot) {
    try {
      const deriveUrl = pathToFileURL(join(okengineRoot, "src/docker/derive.ts")).href;
      const mod = (await import(deriveUrl)) as {
        deriveInfrastructure: (opts: {
          images: Readonly<Record<string, string>>;
          app?: string;
          composeDir?: string;
          includeApp?: boolean;
          prod?: boolean;
          layout?: "single" | "split" | "stack";
        }) => {
          files: readonly { path: string; content: string }[];
        };
        writeDerivedFiles: (
          result: { files: readonly { path: string; content: string }[] },
          outDir: string,
          options?: { writeStackEnv?: boolean },
        ) => Promise<readonly string[]>;
      };
      const result = mod.deriveInfrastructure({
        images,
        app: "app",
        composeDir: "docker",
        includeApp: true,
        prod: true,
        layout: "single",
      });
      const dockerDir = join(targetDir, "docker");
      await mod.writeDerivedFiles(result, dockerDir, { writeStackEnv: false });
      return result.files
        .filter(
          (f) => f.path.endsWith(".yml") || f.path === "Dockerfile" || f.path.endsWith(".toml"),
        )
        .map((f) => `docker/${f.path}`);
    } catch {
      // Fall through to stub when derive fails (published create-oke, etc.).
    }
  }

  return writeMinimalComposeStub(targetDir);
}

/**
 * Minimal committed-style single-file compose with postgres + redis healthchecks.
 *
 * @param targetDir - Project root
 */
function writeMinimalComposeStub(targetDir: string): string[] {
  const dockerDir = join(targetDir, "docker");
  mkdirSync(dockerDir, { recursive: true });
  const compose = `# Generated by create-oke (minimal stub when okengine derive is unavailable).
# Local overrides: docker-compose.override.yml (do not commit secrets).

name: oke-app

networks:
  oke:
    driver: bridge

services:
  # App — okengine runtime
  app:
    image: oke-app:latest
    build:
      context: ..
      dockerfile: Dockerfile
    ports:
      - "6530:6530"
    env_file:
      - .env.docker
    depends_on:
      store-sql:
        condition: service_healthy
      store-kv:
        condition: service_healthy
    networks:
      - oke
    healthcheck:
      test:
        - CMD
        - bun
        - -e
        - fetch("http://127.0.0.1:6530/_/ready").then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 60s
    stop_grace_period: 30s
    deploy:
      replicas: 1
      resources:
        limits:
          cpus: "0.72"
          memory: 1475M

  # store.sql — Postgres
  store-sql:
    image: postgres:18-alpine
    ports:
      - "127.0.0.1:5432:5432"
    networks:
      - oke
    env_file:
      - .env.docker
    environment:
      POSTGRES_USER: \${OKE_STORE_SQL_USER}
      POSTGRES_PASSWORD: \${OKE_STORE_SQL_PASSWORD}
      POSTGRES_DB: \${OKE_STORE_SQL_DB}
    healthcheck:
      test:
        - CMD-SHELL
        - pg_isready -U $$POSTGRES_USER
      interval: 5s
      timeout: 3s
      retries: 10
    deploy:
      resources:
        limits:
          cpus: "1.08"
          memory: 2212M

  # store.kv — Redis
  store-kv:
    image: redis:8-alpine
    ports:
      - "127.0.0.1:6379:6379"
    networks:
      - oke
    env_file:
      - .env.docker
    command:
      - sh
      - -c
      - exec redis-server --requirepass "$$OKE_STORE_KV_PASSWORD"
    healthcheck:
      test:
        - CMD
        - redis-cli
        - -a
        - \${OKE_STORE_KV_PASSWORD}
        - ping
      interval: 5s
      timeout: 3s
      retries: 10
    deploy:
      resources:
        limits:
          cpus: "0.54"
          memory: 1106M
`;
  writeFileSync(join(dockerDir, "docker-compose.yml"), compose, "utf8");
  return ["docker/docker-compose.yml"];
}

/**
 * Recursively copy template files, applying {@link shouldSkipTemplatePath}.
 *
 * @param srcRoot - Template root
 * @param dstRoot - Destination root
 * @param rel - Relative path under the roots
 * @param written - Accumulator for relative paths written
 */
function copyTree(srcRoot: string, dstRoot: string, rel: string, written: string[]): void {
  const src = rel ? join(srcRoot, rel) : srcRoot;
  const st = statSync(src);
  if (st.isDirectory()) {
    if (rel && shouldSkipTemplatePath(rel)) return;
    if (rel) mkdirSync(join(dstRoot, rel), { recursive: true });
    for (const entry of readdirSync(src)) {
      copyTree(srcRoot, dstRoot, rel ? join(rel, entry) : entry, written);
    }
    return;
  }
  if (!st.isFile()) return;
  const posixRel = rel.split(/[/\\]/).join("/");
  if (shouldSkipTemplatePath(posixRel)) return;
  const dst = join(dstRoot, rel);
  mkdirSync(join(dst, ".."), { recursive: true });
  cpSync(src, dst);
  written.push(posixRel);
}

/**
 * List relative file paths in a source tree using the same skip rules as scaffold.
 *
 * @param templateDir - Absolute template directory
 */
export function listTemplateFiles(templateDir: string): string[] {
  const out: string[] = [];
  walk(templateDir, templateDir, out);
  out.sort();
  return out;
}

/**
 * @param root - Template root
 * @param dir - Current directory
 * @param out - Accumulator
 */
function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = relative(root, abs).split(/[/\\]/).join("/");
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (shouldSkipTemplatePath(rel)) continue;
      walk(root, abs, out);
      continue;
    }
    if (st.isFile() && !shouldSkipTemplatePath(rel)) out.push(rel);
  }
}
