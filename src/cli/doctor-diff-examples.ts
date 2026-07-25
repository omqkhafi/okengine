#!/usr/bin/env bun
/**
 * CI gate: `oke doctor --diff` across the four reference apps.
 *
 * Extracts Manifests from working-tree sources and from the git merge-base,
 * then fails on undeclared contract breaks.
 */

import { Glob } from "bun";
import { resolve } from "node:path";
import { extractManifest, type SourceFile } from "../compiler/extract.ts";
import { undeclaredContractBreaks } from "../manifest/undeclared.ts";
import { gitMergeBase, gitShow } from "./doctor-diff.ts";

const ROOT = resolve(import.meta.dir, "../..");
const APPS = ["notes", "linkly", "provisions", "skyport"] as const;

/**
 * Run undeclared-break checks for every example app.
 *
 * @returns Exit code
 */
export async function runDoctorDiffExamples(): Promise<number> {
  const mergeBase = await gitMergeBase(ROOT);
  let failed = 0;

  for (const app of APPS) {
    const rootDir = resolve(ROOT, `examples/${app}`);
    const after = await extractManifest({ rootDir });
    const extracted = mergeBase
      ? await extractAtRevision(ROOT, mergeBase, `examples/${app}`)
      : after;
    // No sources at merge-base → empty baseline (additions are no-impact).
    const before = extracted ?? { oke: after.oke, app: after.app };

    const undeclared = undeclaredContractBreaks(before, after);
    if (undeclared.length === 0) {
      console.log(`oke doctor --diff examples/${app}: ok`);
      continue;
    }
    failed++;
    console.log(
      `oke doctor --diff examples/${app}: ${undeclared.length} undeclared contract-breaking change(s)`,
    );
    for (const c of undeclared) {
      console.log(`  [contract-breaking] ${c.path}: ${c.summary}`);
    }
  }

  if (failed > 0) {
    console.log(
      "Acknowledge intentional breaks with `breaking: true` on the owning flow.",
    );
  }
  return failed > 0 ? 1 : 0;
}

/**
 * Extract a Manifest from sources as they existed at a git revision.
 *
 * @param repoRoot - Repository root
 * @param rev - Commit-ish
 * @param appRel - App directory relative to repo root (e.g. `examples/notes`)
 */
async function extractAtRevision(
  repoRoot: string,
  rev: string,
  appRel: string,
): Promise<Awaited<ReturnType<typeof extractManifest>> | null> {
  const workingRoot = resolve(repoRoot, appRel);
  const glob = new Glob("**/*.{ts,tsx}");
  const files: SourceFile[] = [];

  for await (const rel of glob.scan({
    cwd: workingRoot,
    onlyFiles: true,
  })) {
    if (rel.includes("node_modules/") || rel.endsWith(".test.ts")) continue;
    const repoPath = `${appRel}/${rel}`;
    const source = await gitShow(repoRoot, rev, repoPath);
    if (source === null) continue;
    files.push({ path: rel, source });
  }

  if (files.length === 0) return null;
  files.sort((a, b) => a.path.localeCompare(b.path));
  return extractManifest({ files });
}

if (import.meta.main) {
  process.exit(await runDoctorDiffExamples());
}
