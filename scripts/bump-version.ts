#!/usr/bin/env bun
/**
 * Atomically bump `okengine` and `create-oke` to the same version.
 *
 * Updates both package.json files and both jsr.json files in lockstep.
 * Does not touch git or the bundled starter's project seed version.
 *
 * Usage:
 *   bun run scripts/bump-version.ts [patch|minor|major] [--dry-run]
 *   bun run scripts/bump-version.ts --set 0.1.0 [--dry-run]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const REPO_ROOT = join(import.meta.dir, "..");

/** Published packages that always share one version timeline. */
const PACKAGE_DIRS = [REPO_ROOT, join(REPO_ROOT, "packages/create-oke")] as const;

/** Semver bump kind. */
type BumpKind = "patch" | "minor" | "major";

/**
 * Parses CLI flags for the bump script.
 */
function parseFlags(): {
  kind: BumpKind | undefined;
  set: string | undefined;
  dryRun: boolean;
} {
  const { values, positionals } = parseArgs({
    options: {
      set: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: true,
    args: process.argv.slice(2),
  });
  const kindRaw = positionals[0];
  const kind =
    kindRaw === "patch" || kindRaw === "minor" || kindRaw === "major" ? kindRaw : undefined;
  return {
    kind,
    set: values.set,
    dryRun: values["dry-run"] ?? false,
  };
}

/**
 * Reads a package or jsr JSON object.
 *
 * @param path - Absolute path to JSON file
 */
function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

/**
 * Writes JSON with trailing newline (2-space indent).
 *
 * @param path - Absolute path
 * @param value - JSON-serializable value
 */
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

/**
 * Parses `X.Y.Z` into numeric parts.
 *
 * @param version - Semver string
 */
function parseSemver(version: string): [number, number, number] {
  const parts = version.trim().replace(/^v/, "").split(".");
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p ?? ""))) {
    throw new Error(`Invalid version '${version}'. Expected X.Y.Z.`);
  }
  return [
    Number.parseInt(parts[0]!, 10),
    Number.parseInt(parts[1]!, 10),
    Number.parseInt(parts[2]!, 10),
  ];
}

/**
 * Applies a bump kind to a version string.
 *
 * @param version - Current version
 * @param kind - patch | minor | major
 */
function bump(version: string, kind: BumpKind): string {
  const [major, minor, patch] = parseSemver(version);
  switch (kind) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
  }
}

/**
 * Ensures every package.json shares the same version before bumping.
 *
 * @returns Current shared version
 */
function assertLockstep(): string {
  const versions = PACKAGE_DIRS.map((dir) => {
    const pkgPath = join(dir, "package.json");
    const pkg = readJson(pkgPath);
    const version = pkg.version;
    if (typeof version !== "string") {
      throw new Error(`${pkgPath} has no string "version" field.`);
    }
    return { pkgPath, version };
  });
  const first = versions[0]!.version;
  for (const v of versions) {
    if (v.version !== first) {
      throw new Error(
        `Version lockstep broken: ${versions[0]!.pkgPath}=${first}, ${v.pkgPath}=${v.version}. Fix manually before bumping.`,
      );
    }
  }
  return first;
}

/**
 * Writes the new version into package.json and jsr.json for one package root.
 *
 * @param dir - Package directory
 * @param version - New shared version
 * @param dryRun - When true, only report paths
 * @returns Paths that would be / were updated
 */
function applyVersion(dir: string, version: string, dryRun: boolean): string[] {
  const updated: string[] = [];
  const pkgPath = join(dir, "package.json");
  const pkg = readJson(pkgPath);
  pkg.version = version;
  updated.push(pkgPath);
  if (!dryRun) writeJson(pkgPath, pkg);

  const jsrPath = join(dir, "jsr.json");
  if (existsSync(jsrPath)) {
    const jsr = readJson(jsrPath);
    jsr.version = version;
    updated.push(jsrPath);
    if (!dryRun) writeJson(jsrPath, jsr);
  }
  return updated;
}

async function main(): Promise<void> {
  const flags = parseFlags();
  if (!flags.set && !flags.kind) {
    console.error(
      "[bump] Usage: bun run scripts/bump-version.ts [patch|minor|major] [--dry-run]\n" +
        "       bun run scripts/bump-version.ts --set X.Y.Z [--dry-run]",
    );
    process.exit(2);
  }
  if (flags.set && flags.kind) {
    console.error("[bump] Pass either a bump kind or --set, not both.");
    process.exit(2);
  }

  const current = assertLockstep();
  const next = flags.set
    ? (parseSemver(flags.set), flags.set.replace(/^v/, ""))
    : bump(current, flags.kind!);

  const files = PACKAGE_DIRS.flatMap((dir) => applyVersion(dir, next, flags.dryRun));

  const prefix = flags.dryRun ? "Would bump" : "Bumped";
  console.error(`[bump] ${prefix}: ${current} → ${next}`);
  for (const f of files) {
    console.error(`[bump]   ${f}`);
  }
}

main().catch((err: unknown) => {
  console.error("[bump]", err);
  process.exit(2);
});
