#!/usr/bin/env bun
/**
 * Publish `okengine` and `create-oke` to npm and/or JSR in lockstep.
 *
 * Syncs each package's version from package.json → jsr.json, then publishes
 * both packages to the selected registries. Modeled on gflows' publish script
 * with an extra loop over the two published packages.
 *
 * Usage:
 *   bun run release -- [--dry-run] [--npm-only | --jsr-only] [--force]
 *
 * Do not name the package.json script `publish` — npm treats that as a
 * lifecycle hook and re-enters this script after `npm publish` succeeds.
 *
 * Flags:
 *   --dry-run    Sync versions only; print intended commands; do not publish.
 *   --npm-only   Publish only to npm.
 *   --jsr-only   Publish only to JSR.
 *   --force      Skip pre-publish checks (clean tree, branch main).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";

const REPO_ROOT = join(import.meta.dir, "..");

/** One published package root (relative to repo root). */
interface PublishPackage {
  /** Directory containing package.json / jsr.json. */
  readonly dir: string;
  /** npm package name (for logs). */
  readonly npmName: string;
}

/**
 * Published packages — always released together on the same version.
 *
 * npm names stay unscoped (`okengine`, `create-oke`) as shipped; JSR scopes
 * live in each package's `jsr.json` (`@omqkhafi/…`).
 */
const PACKAGES: readonly PublishPackage[] = [
  { dir: REPO_ROOT, npmName: "okengine" },
  {
    dir: join(REPO_ROOT, "packages/create-oke"),
    npmName: "create-oke",
  },
];

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  [key: string]: unknown;
}

interface JsrJson {
  name?: string;
  version?: string;
  description?: string;
  exports?: string | Record<string, string>;
  publish?: { include?: string[]; exclude?: string[] };
  [key: string]: unknown;
}

/**
 * Parses CLI flags for the publish script.
 */
function parseFlags(): {
  dryRun: boolean;
  npmOnly: boolean;
  jsrOnly: boolean;
  force: boolean;
} {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      "npm-only": { type: "boolean", default: false },
      "jsr-only": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
    allowPositionals: true,
    args: process.argv.slice(2),
  });
  return {
    dryRun: values["dry-run"] ?? false,
    npmOnly: values["npm-only"] ?? false,
    jsrOnly: values["jsr-only"] ?? false,
    force: values.force ?? false,
  };
}

/**
 * Reads and parses package.json from a package directory.
 *
 * @param dir - Package root
 */
function readPackageJson(dir: string): PackageJson {
  const path = join(dir, "package.json");
  return JSON.parse(readFileSync(path, "utf-8")) as PackageJson;
}

/**
 * Reads jsr.json from a package directory, or null if missing.
 *
 * @param dir - Package root
 */
function readJsrJson(dir: string): JsrJson | null {
  const path = join(dir, "jsr.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as JsrJson;
}

/**
 * Writes jsr.json (pretty-printed, trailing newline).
 *
 * @param dir - Package root
 * @param jsr - Manifest content
 */
function writeJsrJson(dir: string, jsr: JsrJson): void {
  writeFileSync(join(dir, "jsr.json"), `${JSON.stringify(jsr, null, 2)}\n`, "utf-8");
}

/**
 * Syncs version (and description) from package.json → jsr.json.
 *
 * @param dir - Package root
 * @returns Synced version string
 */
function syncVersion(dir: string): string {
  const pkg = readPackageJson(dir);
  const version = pkg.version ?? "0.0.0";
  let jsr = readJsrJson(dir);
  if (!jsr) {
    jsr = {
      name: pkg.name ?? "okengine",
      version,
      description: pkg.description,
      exports: "./src/index.ts",
    };
  } else {
    jsr.version = version;
    if (pkg.description !== undefined) jsr.description = pkg.description;
  }
  writeJsrJson(dir, jsr);
  return version;
}

/**
 * Asserts both packages share the same version before publishing.
 *
 * @returns Shared version
 */
function assertLockstepVersions(): string {
  const versions = PACKAGES.map((p) => {
    const pkg = readPackageJson(p.dir);
    if (typeof pkg.version !== "string") {
      throw new Error(`${p.npmName}: package.json missing version`);
    }
    return { name: p.npmName, version: pkg.version };
  });
  const first = versions[0]!.version;
  for (const v of versions) {
    if (v.version !== first) {
      throw new Error(
        `Version lockstep broken: ${versions.map((x) => `${x.name}@${x.version}`).join(", ")}. Bump both with scripts/bump-version.ts.`,
      );
    }
  }
  return first;
}

/**
 * Runs a command; returns true when exit code is 0.
 *
 * @param cmd - argv
 * @param opts - cwd / verbosity
 */
function run(cmd: string[], opts: { cwd: string; verbose?: boolean }): Promise<boolean> {
  const { cwd, verbose = true } = opts;
  if (verbose) {
    console.error(`[publish] (${relative(REPO_ROOT, cwd) || "."}) ${cmd.join(" ")}`);
  }
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return proc.exited.then((code) => code === 0);
}

/**
 * Checks whether the working tree is clean.
 */
async function isCleanTree(): Promise<boolean> {
  const proc = Bun.spawn(["git", "status", "--porcelain"], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim() === "";
}

/**
 * Returns the current Git branch name, or null when detached / not a repo.
 */
async function getCurrentBranch(): Promise<string | null> {
  const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) return null;
  const branch = out.trim();
  return branch && branch !== "HEAD" ? branch : null;
}

/**
 * Pre-publish checks: clean tree and branch is main. Skip if --force.
 *
 * @param force - Skip checks when true
 */
async function prePublishChecks(force: boolean): Promise<void> {
  if (force) return;

  const clean = await isCleanTree();
  if (!clean) {
    console.error(
      "[publish] Working tree is not clean. Commit or stash changes, or use --force to skip.",
    );
    process.exit(2);
  }

  const branch = await getCurrentBranch();
  if (branch !== "main") {
    console.error(
      `[publish] Current branch is "${branch ?? "detached"}", not main. Checkout main or use --force to skip.`,
    );
    process.exit(2);
  }
}

/**
 * Publishes one package to the selected registries.
 *
 * @param pkg - Package descriptor
 * @param flags - Registry selection / dry-run
 */
async function publishOne(
  pkg: PublishPackage,
  flags: { dryRun: boolean; npmOnly: boolean; jsrOnly: boolean },
): Promise<void> {
  const label = relative(REPO_ROOT, pkg.dir) || ".";
  if (!existsSync(join(pkg.dir, "package.json"))) {
    console.error(`[publish] package.json not found in ${label}.`);
    process.exit(2);
  }

  const version = syncVersion(pkg.dir);
  console.error(`[publish] ${pkg.npmName}@${version} (${label})`);

  // okengine ships prebuilt Console SPA; create-oke templates need a prepack sync.
  const needsConsoleBuild = pkg.npmName === "okengine";
  const needsTemplateSync =
    pkg.npmName === "create-oke" && existsSync(join(pkg.dir, "src/sync-templates.ts"));

  if (flags.dryRun) {
    if (needsConsoleBuild) {
      console.error(`  would: bun run build  (cwd=${label})`);
    }
    if (needsTemplateSync) {
      console.error(`  would: bun ./src/sync-templates.ts  (cwd=${label})`);
    }
    if (!flags.jsrOnly) console.error(`  would: npm publish  (cwd=${label})`);
    if (!flags.npmOnly) {
      console.error(`  would: bunx jsr publish --allow-dirty  (cwd=${label})`);
    }
    return;
  }

  if (needsConsoleBuild) {
    const ok = await run(["bun", "run", "build"], { cwd: pkg.dir });
    if (!ok) {
      console.error(`[publish] Console UI build failed.`);
      process.exit(2);
    }
  }

  if (needsTemplateSync) {
    const ok = await run(["bun", "./src/sync-templates.ts"], { cwd: pkg.dir });
    if (!ok) {
      console.error(`[publish] create-oke template sync failed.`);
      process.exit(2);
    }
  }

  const doNpm = !flags.jsrOnly;
  const doJsr = !flags.npmOnly;

  if (doNpm) {
    // --ignore-scripts: prepack work already ran above; also blocks a
    // recursive lifecycle if package.json ever regains a `publish` script.
    const ok = await run(["npm", "publish", "--access", "public", "--ignore-scripts"], {
      cwd: pkg.dir,
    });
    if (!ok) {
      console.error(`[publish] npm publish failed for ${pkg.npmName}.`);
      process.exit(2);
    }
  }

  if (doJsr) {
    // syncVersion() dirtied jsr.json; JSR requires --allow-dirty.
    const ok = await run(["bunx", "jsr", "publish", "--allow-dirty"], {
      cwd: pkg.dir,
    });
    if (!ok) {
      console.error(`[publish] jsr publish failed for ${pkg.npmName}.`);
      process.exit(2);
    }
  }
}

async function main(): Promise<void> {
  const flags = parseFlags();
  if (flags.npmOnly && flags.jsrOnly) {
    console.error("[publish] Pass at most one of --npm-only / --jsr-only.");
    process.exit(2);
  }

  const version = assertLockstepVersions();
  console.error(`[publish] Lockstep version: ${version}`);

  if (!flags.dryRun) {
    await prePublishChecks(flags.force);
  }

  for (const pkg of PACKAGES) {
    await publishOne(pkg, flags);
  }

  console.error(flags.dryRun ? "[publish] Dry run done." : "[publish] Done.");
}

main().catch((err: unknown) => {
  console.error("[publish]", err);
  process.exit(2);
});
