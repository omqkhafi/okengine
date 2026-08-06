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
import {
  resolveLocalOkengineRoot,
  resolveTemplateDir,
  TEMPLATE_DEFAULT_MODE,
  type TemplateId,
} from "./templates.ts";
import { agentsMdContent } from "./agents-md.ts";
import type { CreateDefaults } from "./create-defaults.ts";
import {
  DEFAULT_SQL_DRIVER,
  applyCreateAnswers,
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
   * Store SQL driver — pins `oke.config.ts` `store.sql` local/docker/prod
   * when `postgres`. Default `sqlite` keeps the dual-mode config.
   * Ignored when {@link createDefaults} is set.
   */
  readonly sqlDriver?: SqlDriverId;
  /** Full customize / reuse answers — applied after copy. */
  readonly createDefaults?: CreateDefaults;
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
export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  const name = sanitizeProjectName(options.name);
  const targetDir = resolve(options.targetDir);
  const sourceDir = resolveTemplateDir(options.source.id);
  const label = options.source.id;
  const createDefaults = options.createDefaults;
  const sqlDriver =
    createDefaults?.drivers.store.sql.local === "postgres" || options.sqlDriver === "postgres"
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

    const envExample = join(targetDir, ".env.example");
    const envLocal = join(targetDir, ".env.local");
    if (existsSync(envExample) && !existsSync(envLocal)) {
      cpSync(envExample, envLocal);
      if (!written.includes(".env.local")) written.push(".env.local");
    }

    // Seed `.oke/mode` so `oke dev` does not re-ask local vs docker.
    writeProjectDevMode(targetDir, resolveInitialDevMode(createDefaults, options.source.id));
    if (!written.includes(".oke/mode")) written.push(".oke/mode");

    written.sort();
    return {
      targetDir,
      name,
      source: options.source,
      label,
      okengineDependency,
      sqlDriver,
      ...(createDefaults !== undefined ? { createDefaults } : {}),
      files: written,
    };
  } catch (e) {
    rmSync(targetDir, { recursive: true, force: true });
    throw e;
  }
}

/**
 * For postgres, pin `store.sql` local/docker/prod in `oke.config.ts`.
 *
 * The default template ships abstract `src/db/schema.decl.ts` — dialect is
 * emitted from the active `store.sql` driver, so there is no hand-written
 * `sqliteTable`/`pgTable` source to rewrite. `sqlite` keeps the template
 * dual-mode config (`local: sqlite` · `docker`/`prod: postgres`) untouched.
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
 * Map create-oke profile / template → persisted `oke dev` mode.
 *
 * @param defaults - Customize / reuse answers, or undefined for recommended
 * @param template - Starter id (recommended path uses template default mode)
 */
export function resolveInitialDevMode(
  defaults: CreateDefaults | undefined,
  template: TemplateId = "standard",
): "local" | "docker" {
  if (defaults?.profile === "docker-ready") return "docker";
  if (defaults?.profile === "local-only") return "local";
  return TEMPLATE_DEFAULT_MODE[template];
}

/**
 * Write project-local `.oke/mode` (same shape as `oke mode` / `oke dev`).
 *
 * @param targetDir - Scaffolded project root
 * @param mode - Mode to save
 */
function writeProjectDevMode(targetDir: string, mode: "local" | "docker"): void {
  mkdirSync(join(targetDir, ".oke"), { recursive: true });
  writeFileSync(join(targetDir, ".oke", "mode"), `${mode}\n`, "utf8");
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
