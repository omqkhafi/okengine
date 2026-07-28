/**
 * Rewrites applied when copying a `templates/<id>` or `examples/<id>` tree
 * into a new project.
 *
 * Exactly:
 * 1. `package.json` `"name"` → the user-provided project name
 * 2. `package.json` `"okengine": "file:../.."` → registry version (or
 *    `file:<okengine-root>` when `CREATE_OKE_OKENGINE` is set)
 * 3. Drop monorepo-only files that import paths outside the source tree
 *    (today: `tests/docker.test.ts`)
 * 4. Optional `--sql` / wizard choice → Drizzle dialect + `store.sql` pins
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { packageRoot } from "./templates.ts";

/** SQL store drivers selectable at scaffold time. */
export const SQL_DRIVERS = ["sqlite", "postgres"] as const;

/** A known store.sql driver id for create-oke. */
export type SqlDriverId = (typeof SQL_DRIVERS)[number];

/** Default when `--sql` / wizard choice is omitted (matches template sources). */
export const DEFAULT_SQL_DRIVER: SqlDriverId = "sqlite";

/**
 * Whether `value` is a known {@link SqlDriverId}.
 *
 * @param value - Candidate string
 */
export function isSqlDriverId(value: string): value is SqlDriverId {
  return (SQL_DRIVERS as readonly string[]).includes(value);
}

/** Shape of an example / scaffolded `package.json`. */
export type ScaffoldPackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  type?: string;
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
};

/**
 * Resolve the `okengine` dependency string written into the scaffolded package.json.
 *
 * - Explicit `CREATE_OKE_OKENGINE` → `file:<monorepo>` (escape hatch only)
 * - Otherwise → registry version of this package
 *
 * Linking the whole monorepo via file: makes bun install traverse the
 * workspace (and any circular template node_modules/okengine nests) and
 * appears hung — never do that by default. In-repo DX uses a registry install
 * plus bun link okengine (see shouldBunLinkLocalOkengine).
 *
 * @param localOkengineRoot - Absolute path when available
 * @param _cwd - Directory create-oke was invoked from (unused; kept for call sites)
 */
export function resolveOkengineDependency(
  localOkengineRoot: string | null,
  _cwd: string = process.cwd(),
): string {
  const envForced = process.env["CREATE_OKE_OKENGINE"];
  if (envForced && localOkengineRoot) {
    return `file:${resolve(localOkengineRoot)}`;
  }
  const pkgPath = join(packageRoot(), "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

/**
 * Whether the scaffolded app should run `bun link okengine` after install.
 *
 * Used when create-oke is `bun link`ed (or otherwise sees the monorepo) but the
 * package.json keeps a registry version so install stays fast — then the global
 * `bun link` of okengine swaps in local framework code.
 *
 * Skip when the dep is already `file:` (in-repo / CREATE_OKE_OKENGINE), or when
 * `CREATE_OKE_NO_LINK=1`.
 *
 * @param okengineDep - Value written into package.json
 * @param localOkengineRoot - Detected monorepo root, if any
 */
export function shouldBunLinkLocalOkengine(
  okengineDep: string,
  localOkengineRoot: string | null,
): boolean {
  if (process.env["CREATE_OKE_NO_LINK"] === "1") return false;
  if (!localOkengineRoot) return false;
  return !okengineDep.startsWith("file:");
}

/**
 * Rewrite an example `package.json` for a new project.
 *
 * @param source - Parsed example package.json
 * @param projectName - npm package name for the new project
 * @param okengineDep - Installable okengine dependency string
 */
export function transformPackageJson(
  source: ScaffoldPackageJson,
  projectName: string,
  okengineDep: string,
): ScaffoldPackageJson {
  const dependencies = { ...source.dependencies };
  if (dependencies["okengine"] !== undefined) {
    dependencies["okengine"] = okengineDep;
  }

  return {
    ...source,
    name: projectName,
    // Starter apps always begin at 0.0.1 — never the framework lockstep version.
    version: "0.0.1",
    dependencies,
  };
}

/**
 * Whether a relative path inside a template should be omitted from the scaffold.
 *
 * Skips install/VCS artefacts and monorepo-only tests that import outside the
 * example (e.g. skyport `tests/docker.test.ts` → `../../../src/cli/docker.ts`).
 *
 * @param relativePath - Path relative to the template root (`/`-separated)
 */
export function shouldSkipTemplatePath(relativePath: string): boolean {
  const parts = relativePath.split(/[/\\]/);
  if (parts.includes("node_modules") || parts.includes(".git")) return true;
  const base = parts[parts.length - 1] ?? "";
  if (
    base === "bun.lock" ||
    base === "bun.lockb" ||
    base === "package-lock.json" ||
    base === "yarn.lock" ||
    base === "pnpm-lock.yaml"
  ) {
    return true;
  }
  // Monorepo CI fixture — not part of the four-applications app tree.
  if (relativePath.replace(/\\/g, "/") === "tests/docker.test.ts") return true;
  return false;
}

/**
 * Rewrite a Drizzle schema file to the dialect for `driver`.
 *
 * Templates ship as `sqliteTable` / `drizzle-orm/sqlite-core`. Choosing
 * `postgres` swaps to `pgTable` / `pg-core` (and the reverse is idempotent).
 *
 * @param source - Schema TypeScript source
 * @param driver - Target store.sql driver
 */
export function transformSchemaForSqlDriver(
  source: string,
  driver: SqlDriverId,
): string {
  if (driver === "postgres") {
    return source
      .replaceAll("drizzle-orm/sqlite-core", "drizzle-orm/pg-core")
      .replaceAll("sqliteTable", "pgTable");
  }
  return source
    .replaceAll("drizzle-orm/pg-core", "drizzle-orm/sqlite-core")
    .replaceAll("pgTable", "sqliteTable");
}

/**
 * Pin `store.sql` `local` / `docker` / `prod` in `oke.config.ts` to `driver`.
 *
 * Leaves `test: "memory"` (and every other facet) untouched.
 *
 * @param source - Config TypeScript source
 * @param driver - Target store.sql driver
 */
export function transformConfigForSqlDriver(
  source: string,
  driver: SqlDriverId,
): string {
  return source.replace(/sql:\s*\{[\s\S]*?\n\s*\}/, (block) =>
    block
      .replace(/local:\s*"(?:sqlite|postgres)"/, `local: "${driver}"`)
      .replace(/docker:\s*"(?:sqlite|postgres)"/, `docker: "${driver}"`)
      .replace(/prod:\s*"(?:sqlite|postgres)"/, `prod: "${driver}"`),
  );
}

/**
 * Sanitize a directory / package name for npm.
 *
 * @param raw - User-provided name
 */
export function sanitizeProjectName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("create-oke: project name must not be empty");
  }
  // Allow scoped names; otherwise lowercase npm-safe slug.
  if (trimmed.startsWith("@")) {
    const m = /^(@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*)$/.exec(
      trimmed,
    );
    if (!m) {
      throw new Error(
        `create-oke: invalid scoped package name "${trimmed}"`,
      );
    }
    return trimmed;
  }
  const name = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._~-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name || !/^[a-z0-9-~]/.test(name)) {
    throw new Error(`create-oke: invalid project name "${raw}"`);
  }
  return name;
}
