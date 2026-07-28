/**
 * Versioned codemod registry — ships with every breaking change (§22).
 *
 * `oke upgrade` runs every applicable transform and prints a diff.
 * Adding a breaking change without a codemod is a process defect; the
 * registry is the checklist.
 */

import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

/** One file rewrite produced by a codemod. */
export interface CodemodChange {
  /** Path relative to the project root. */
  readonly path: string;
  /** Original file contents. */
  readonly before: string;
  /** Transformed file contents. */
  readonly after: string;
}

/** One registered breaking-change transform. */
export interface Codemod {
  /** Stable id (e.g. `0.1.0-rename-fx-ask`). */
  readonly id: string;
  /** Semver range this applies when upgrading from. */
  readonly from: string;
  /** Semver this lands in. */
  readonly to: string;
  /** One-line description for `oke upgrade` output. */
  readonly description: string;
  /**
   * Apply the transform.
   *
   * @param cwd - Project root
   */
  readonly apply: (cwd: string) => Promise<readonly CodemodChange[]>;
}

/**
 * Rewrite driver-map keys `dev:` → `local:` and `stack:` → `docker:`.
 *
 * Vault `dev:` fallbacks are intentionally excluded — callers pass only
 * `oke.config.*` paths into this rewriter.
 *
 * @param source - File contents
 */
export function rewriteConfigEnvKeys(source: string): string {
  return source
    .replace(/(^|[^\w.])dev(\s*:)/gm, "$1local$2")
    .replace(/(^|[^\w.])stack(\s*:)/gm, "$1docker$2");
}

/**
 * Rewrite removed vault stack markers to docker equivalents.
 *
 * @param source - File contents
 */
export function rewriteFromStackMarkers(source: string): string {
  return source
    .replace(/\bfromStack\b/g, "fromDocker")
    .replace(/\bFROM_STACK_PREFIX\b/g, "FROM_DOCKER_PREFIX")
    .replace(/\bisFromStack\b/g, "isFromDocker")
    .replace(/\bfromStackRole\b/g, "fromDockerRole")
    .replace(/__oke_from_stack__/g, "__oke_from_docker__");
}

/**
 * Collect `oke.config.*` files under a project root.
 *
 * @param cwd - Project root
 */
async function collectConfigCandidates(cwd: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of ["oke.config.ts", "oke.config.mts", "oke.config.js"]) {
    const path = resolve(cwd, name);
    if (await Bun.file(path).exists()) out.push(path);
  }
  return out;
}

/**
 * Collect TypeScript sources that may reference `fromStack`.
 *
 * @param cwd - Project root
 */
async function collectVaultCandidates(cwd: string): Promise<string[]> {
  const out: string[] = [];
  const roots = ["src", "app"];
  for (const root of roots) {
    const dir = resolve(cwd, root);
    try {
      await walkTs(dir, out);
    } catch {
      // missing dir
    }
  }
  return out;
}

/**
 * @param dir - Directory
 * @param out - Accumulator of absolute paths
 */
async function walkTs(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await walkTs(path, out);
    } else if (entry.isFile() && /\.(ts|mts|tsx)$/.test(entry.name)) {
      out.push(path);
    }
  }
}

/**
 * Built-in transforms.
 */
export const CODEMODS: readonly Codemod[] = [
  {
    id: "0.2.7-config-env-local-docker",
    from: "0.2.6",
    to: "0.2.7",
    description: "Rename driver-map keys dev→local, stack→docker; fromStack→fromDocker",
    async apply(cwd) {
      const changes: CodemodChange[] = [];
      for (const path of await collectConfigCandidates(cwd)) {
        const before = await Bun.file(path).text();
        const after = rewriteConfigEnvKeys(before);
        if (after !== before) {
          changes.push({
            path: relative(cwd, path) || path,
            before,
            after,
          });
        }
      }
      for (const path of await collectVaultCandidates(cwd)) {
        const before = await Bun.file(path).text();
        const after = rewriteFromStackMarkers(before);
        if (after !== before) {
          changes.push({
            path: relative(cwd, path) || path,
            before,
            after,
          });
        }
      }
      return changes;
    },
  },
];

/**
 * Validate the registry (unique ids, non-empty metadata, apply present).
 *
 * @param registry - Codemods to validate (defaults to {@link CODEMODS})
 */
export function validateCodemodRegistry(
  registry: readonly Codemod[] = CODEMODS,
): readonly string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const mod of registry) {
    if (!mod.id.trim()) errors.push("codemod missing id");
    else if (seen.has(mod.id)) errors.push(`duplicate codemod id: ${mod.id}`);
    else seen.add(mod.id);
    if (!mod.from.trim()) errors.push(`${mod.id}: missing from`);
    if (!mod.to.trim()) errors.push(`${mod.id}: missing to`);
    if (!mod.description.trim()) errors.push(`${mod.id}: missing description`);
    if (typeof mod.apply !== "function") {
      errors.push(`${mod.id}: apply must be a function`);
    }
  }
  return errors;
}

/**
 * Run every registered codemod and collect file rewrites.
 *
 * @param cwd - Project root
 * @param registry - Codemods (defaults to {@link CODEMODS})
 */
export async function runCodemods(
  cwd: string,
  registry: readonly Codemod[] = CODEMODS,
): Promise<readonly CodemodChange[]> {
  const out: CodemodChange[] = [];
  for (const mod of registry) {
    const changes = await mod.apply(cwd);
    out.push(...changes);
  }
  return out;
}
