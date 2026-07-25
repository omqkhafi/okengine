/**
 * Copy an `examples/<template>` tree and apply the package.json transform.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  resolveLocalOkengineRoot,
  resolveTemplateDir,
  type TemplateId,
} from "./templates.ts";
import {
  sanitizeProjectName,
  shouldSkipTemplatePath,
  transformPackageJson,
  resolveOkengineDependency,
  type ScaffoldPackageJson,
} from "./transform.ts";

/** Options for {@link scaffold}. */
export type ScaffoldOptions = {
  /** Destination directory (created). Absolute or cwd-relative. */
  readonly targetDir: string;
  /** npm package / folder name. */
  readonly name: string;
  /** Template id (default: notes). */
  readonly template: TemplateId;
};

/** Result of a successful scaffold. */
export type ScaffoldResult = {
  readonly targetDir: string;
  readonly name: string;
  readonly template: TemplateId;
  readonly okengineDependency: string;
  /** Relative paths written (POSIX), sorted. */
  readonly files: readonly string[];
};

/**
 * Scaffold a new okengine project from `examples/<template>`.
 *
 * @param options - Name, template, destination
 */
export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  const name = sanitizeProjectName(options.name);
  const targetDir = resolve(options.targetDir);
  const templateDir = resolveTemplateDir(options.template);

  if (existsSync(targetDir)) {
    const entries = readdirSync(targetDir);
    if (entries.length > 0) {
      throw new Error(
        `create-oke: target directory is not empty: ${targetDir}`,
      );
    }
  } else {
    mkdirSync(targetDir, { recursive: true });
  }

  const okengineDependency = resolveOkengineDependency(
    resolveLocalOkengineRoot(),
  );
  const written: string[] = [];

  copyTree(templateDir, targetDir, "", written);

  const pkgPath = join(targetDir, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(
      `create-oke: template "${options.template}" has no package.json`,
    );
  }
  const sourcePkg = JSON.parse(
    readFileSync(pkgPath, "utf8"),
  ) as ScaffoldPackageJson;
  const nextPkg = transformPackageJson(sourcePkg, name, okengineDependency);
  writeFileSync(pkgPath, `${JSON.stringify(nextPkg, null, 2)}\n`, "utf8");

  written.sort();
  return {
    targetDir,
    name,
    template: options.template,
    okengineDependency,
    files: written,
  };
}

/**
 * Recursively copy template files, applying {@link shouldSkipTemplatePath}.
 *
 * @param srcRoot - Template root
 * @param dstRoot - Destination root
 * @param rel - Relative path under the roots
 * @param written - Accumulator for relative paths written
 */
function copyTree(
  srcRoot: string,
  dstRoot: string,
  rel: string,
  written: string[],
): void {
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
 * List relative file paths in an example tree using the same skip rules as scaffold.
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
