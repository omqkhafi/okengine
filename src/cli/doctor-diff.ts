/**
 * `oke doctor --diff` — CI gate blocking undeclared contract breaks.
 *
 * Default baseline: git merge-base with `main`/`master` vs the working tree.
 * Escape hatch: explicit `--before` / `--after` manifest JSON paths.
 */

import { resolve } from "node:path";
import { diffManifest } from "../manifest/diff.ts";
import type { Manifest, ManifestChange } from "../manifest/types.ts";
import { undeclaredContractBreaks } from "../manifest/undeclared.ts";
import { loadManifest } from "./load-config.ts";

/** Default remote base branch candidates. */
const BASE_BRANCH_CANDIDATES = ["main", "master", "origin/main", "origin/master"] as const;

/** Options for {@link runDoctorDiff}. */
export interface DoctorDiffOptions {
  readonly cwd?: string;
  /** Explicit before manifest (JSON path or injected). */
  readonly beforePath?: string;
  /** Explicit after manifest (JSON path or injected). */
  readonly afterPath?: string;
  /** Injected before manifest (tests). */
  readonly before?: Manifest;
  /** Injected after manifest (tests). */
  readonly after?: Manifest;
  /** Preferred base branch for merge-base (default: first of main/master). */
  readonly baseBranch?: string;
  /**
   * Resolve the merge-base commit (tests).
   *
   * @param cwd - Repo root
   * @param baseBranch - Preferred base
   */
  readonly resolveMergeBase?: (
    cwd: string,
    baseBranch?: string,
  ) => Promise<string | null>;
  /**
   * Read a file at a git revision (tests).
   *
   * @param cwd - Repo root
   * @param rev - Commit-ish
   * @param path - Path relative to repo root
   */
  readonly readAtRevision?: (
    cwd: string,
    rev: string,
    path: string,
  ) => Promise<string | null>;
  /** Manifest relative path when using git (default: auto-detect). */
  readonly manifestPath?: string;
  readonly write?: (text: string) => void;
}

/** Result of a doctor --diff run. */
export interface DoctorDiffResult {
  readonly code: number;
  readonly undeclared: readonly ManifestChange[];
  readonly allChanges: readonly ManifestChange[];
}

/**
 * Diff two manifests and fail on undeclared contract breaks.
 *
 * @param options - Paths / injections / git helpers
 */
export async function runDoctorDiff(
  options: DoctorDiffOptions = {},
): Promise<DoctorDiffResult> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const cwd = options.cwd ?? process.cwd();

  const { before, after } = await resolveManifests(cwd, options);
  const all = diffManifest(before, after).changes;
  const undeclared = undeclaredContractBreaks(before, after);

  if (undeclared.length === 0) {
    write(
      all.length === 0
        ? "oke doctor --diff: ok (no behavioural changes)\n"
        : `oke doctor --diff: ok (${all.length} change(s), no undeclared contract breaks)\n`,
    );
    return { code: 0, undeclared, allChanges: all };
  }

  write(
    `oke doctor --diff: ${undeclared.length} undeclared contract-breaking change(s)\n`,
  );
  for (const c of undeclared) {
    write(`  [contract-breaking] ${c.path}: ${c.summary}\n`);
  }
  write(
    "Acknowledge intentional breaks with `breaking: true` on the owning flow.\n",
  );
  return { code: 1, undeclared, allChanges: all };
}

/**
 * Resolve before/after manifests from options or git merge-base.
 *
 * @param cwd - Project root
 * @param options - Diff options
 */
async function resolveManifests(
  cwd: string,
  options: DoctorDiffOptions,
): Promise<{ before: Manifest; after: Manifest }> {
  if (options.before && options.after) {
    return { before: options.before, after: options.after };
  }

  if (options.beforePath && options.afterPath) {
    return {
      before: options.before ?? (await loadManifest(resolve(cwd, options.beforePath))),
      after: options.after ?? (await loadManifest(resolve(cwd, options.afterPath))),
    };
  }

  if (options.beforePath || options.afterPath) {
    throw new Error(
      "oke doctor --diff: pass both --before and --after, or neither (git merge-base default)",
    );
  }

  const rel =
    options.manifestPath ??
    (await detectManifestRel(cwd));
  if (!rel) {
    throw new Error(
      "oke doctor --diff: no oke.manifest.json or manifest.oke.json in cwd — pass --before/--after",
    );
  }

  const after =
    options.after ?? (await loadManifest(resolve(cwd, rel)));

  const resolveBase =
    options.resolveMergeBase ?? gitMergeBase;
  const readAt = options.readAtRevision ?? gitShow;
  const mergeBase = await resolveBase(cwd, options.baseBranch);
  if (!mergeBase) {
    // No git history / first commit — nothing to break against.
    return { before: after, after };
  }

  const beforeText = await readAt(cwd, mergeBase, rel);
  if (beforeText === null) {
    // Manifest did not exist at merge-base — treat as empty baseline.
    return {
      before: { oke: after.oke, app: after.app },
      after,
    };
  }

  const before = options.before ?? (JSON.parse(beforeText) as Manifest);
  return { before, after };
}

/**
 * Detect a committed manifest filename under cwd.
 *
 * @param cwd - Project root
 */
async function detectManifestRel(cwd: string): Promise<string | null> {
  for (const name of ["oke.manifest.json", "manifest.oke.json"]) {
    if (await Bun.file(resolve(cwd, name)).exists()) return name;
  }
  return null;
}

/**
 * Resolve merge-base with main/master (or a preferred branch).
 *
 * @param cwd - Repo root
 * @param baseBranch - Preferred base
 */
export async function gitMergeBase(
  cwd: string,
  baseBranch?: string,
): Promise<string | null> {
  const candidates = baseBranch
    ? [baseBranch, ...BASE_BRANCH_CANDIDATES.filter((b) => b !== baseBranch)]
    : [...BASE_BRANCH_CANDIDATES];

  for (const base of candidates) {
    const proc = Bun.spawn(
      ["git", "merge-base", "HEAD", base],
      { cwd, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (exitCode === 0) {
      const rev = stdout.trim();
      if (rev.length > 0) return rev;
    }
  }
  return null;
}

/**
 * Read a file blob at a git revision.
 *
 * @param cwd - Repo root
 * @param rev - Commit-ish
 * @param path - Path relative to repo root
 */
export async function gitShow(
  cwd: string,
  rev: string,
  path: string,
): Promise<string | null> {
  const proc = Bun.spawn(["git", "show", `${rev}:${path}`], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) return null;
  return stdout;
}

/**
 * CLI entry for `oke doctor --diff`.
 *
 * @param args - Full args after `doctor` (includes `--diff`)
 */
export async function doctorDiffCli(args: readonly string[]): Promise<number> {
  let beforePath: string | undefined;
  let afterPath: string | undefined;
  let baseBranch: string | undefined;
  let manifestPath: string | undefined;
  let cwd: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--diff") continue;
    if (a === "--before") beforePath = args[++i];
    else if (a === "--after") afterPath = args[++i];
    else if (a === "--base") baseBranch = args[++i];
    else if (a === "--manifest" || a === "-m") manifestPath = args[++i];
    else if (a === "--cwd") cwd = args[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`oke doctor --diff [--before <path> --after <path>] [--base main]

CI gate: fail on undeclared contract-breaking Manifest changes.
Default: git merge-base (main/master) vs working-tree manifest.
Acknowledge intentional breaks with breaking: true on the flow.
`);
      return 0;
    }
  }

  try {
    const { code } = await runDoctorDiff({
      cwd,
      beforePath,
      afterPath,
      baseBranch,
      manifestPath,
    });
    return code;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
