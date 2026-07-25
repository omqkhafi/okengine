/**
 * Rewrites applied when copying a `templates/<id>` or `examples/<id>` tree
 * into a new project.
 *
 * Exactly:
 * 1. `package.json` `"name"` → the user-provided project name
 * 2. `package.json` `"okengine": "file:../.."` → an installable reference
 *    (absolute `file:<okengine-root>` in the monorepo; registry version otherwise)
 * 3. Drop monorepo-only files that import paths outside the source tree
 *    (today: `tests/docker.test.ts`)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "./templates.ts";

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
 * - Monorepo / local: `file:<absolute-okengine-root>` (installable; not `file:../..`)
 * - Published create-oke: the version of this package (kept in lockstep with okengine)
 *
 * @param localOkengineRoot - Absolute path when available
 */
export function resolveOkengineDependency(
  localOkengineRoot: string | null,
): string {
  if (localOkengineRoot) return `file:${localOkengineRoot}`;
  const pkgPath = join(packageRoot(), "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
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
