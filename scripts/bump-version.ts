#!/usr/bin/env bun
/**
 * Atomically bump `okengine` and `create-oke` to the same version.
 *
 * Updates both package.json files and both jsr.json files in lockstep,
 * and promotes `## Unreleased` in `changelog.md` into
 * `## v<new> — <today>`. Does not touch git or the bundled starter's
 * project seed version.
 *
 * Usage:
 *   bun run scripts/bump-version.ts [patch|minor|major] [--dry-run]
 *   bun run scripts/bump-version.ts --set 0.1.0 [--dry-run]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const REPO_ROOT = join(import.meta.dir, "..");
const CHANGELOG_PATH = join(REPO_ROOT, "changelog.md");

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
 * Replaces the top-level `"version"` string in a JSON manifest in place.
 * Preserves oxfmt layout (compact arrays stay compact) — full re-stringify
 * was expanding `jsr.json` publish lists and failing `fmt:check`.
 *
 * @param path - Absolute path to package.json or jsr.json
 * @param version - New semver string
 * @param dryRun - When true, do not write
 */
function setManifestVersion(path: string, version: string, dryRun: boolean): void {
  const raw = readFileSync(path, "utf-8");
  const next = raw.replace(/("version"\s*:\s*")([^"]*)(")/, `$1${version}$3`);
  if (next === raw) {
    throw new Error(`${path} has no "version" string field to replace.`);
  }
  const parsed = JSON.parse(next) as { version?: unknown };
  if (parsed.version !== version) {
    throw new Error(`${path}: version rewrite failed (got ${String(parsed.version)}).`);
  }
  if (!dryRun) writeFileSync(path, next, "utf-8");
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
  setManifestVersion(pkgPath, version, dryRun);
  updated.push(pkgPath);

  const jsrPath = join(dir, "jsr.json");
  if (existsSync(jsrPath)) {
    setManifestVersion(jsrPath, version, dryRun);
    updated.push(jsrPath);
  }
  return updated;
}

/** Local calendar date as `YYYY-MM-DD`. */
function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Promote `## Unreleased` into `## v{version} — {date}`, leaving a fresh
 * empty Unreleased section for the next cycle.
 *
 * @param raw - Full changelog.md text
 * @param version - Bare next version (no `v`)
 * @param date - ISO date for the new heading
 * @returns Updated changelog text
 */
export function promoteUnreleasedSection(raw: string, version: string, date: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^## Unreleased\s*$/.test(lines[i]!)) {
      start = i;
      continue;
    }
    if (start !== -1 && end === -1 && /^##\s+/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  if (start === -1) {
    throw new Error(
      "changelog.md has no ## Unreleased section — oke-ship writes upcoming notes there; bump promotes them.",
    );
  }
  if (end === -1) end = lines.length;

  const body = lines.slice(start + 1, end);
  while (body.length > 0 && body[0]!.trim() === "") body.shift();
  while (body.length > 0 && body[body.length - 1]!.trim() === "") body.pop();

  if (!body.some((line) => /^-\s+/.test(line.trim()))) {
    throw new Error("## Unreleased has no bullets — add ship notes with oke-ship before bumping.");
  }

  const before = lines.slice(0, start);
  const after = lines.slice(end);
  // Drop a leading blank on `after` so we don't stack empties under the new section.
  const rest = after[0]?.trim() === "" ? after.slice(1) : after;

  return [...before, "## Unreleased", "", `## v${version} — ${date}`, "", ...body, "", ...rest]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Promote Unreleased in the on-disk changelog (or report the path on dry-run).
 *
 * @param version - Next bare version
 * @param dryRun - When true, do not write
 */
function applyChangelog(version: string, dryRun: boolean): string {
  const raw = readFileSync(CHANGELOG_PATH, "utf-8");
  try {
    const next = promoteUnreleasedSection(raw, version, todayLocal());
    if (!dryRun) writeFileSync(CHANGELOG_PATH, next.endsWith("\n") ? next : `${next}\n`, "utf-8");
  } catch (err) {
    // A rehearsal right after a release finds an empty Unreleased: report the
    // path anyway. Real bumps keep the hard failure — never cut an empty release.
    if (!dryRun) throw err;
    console.error(`[bump]   note: ${(err as Error).message}`);
  }
  return CHANGELOG_PATH;
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

  const files = [
    ...PACKAGE_DIRS.flatMap((dir) => applyVersion(dir, next, flags.dryRun)),
    applyChangelog(next, flags.dryRun),
  ];

  const prefix = flags.dryRun ? "Would bump" : "Bumped";
  console.error(`[bump] ${prefix}: ${current} → ${next}`);
  for (const f of files) {
    console.error(`[bump]   ${f}`);
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error("[bump]", err);
    process.exit(2);
  });
}
