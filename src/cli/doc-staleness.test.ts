/**
 * Gate: removed legacy stack-mode soft-compat stays gone.
 *
 * Mirrors {@link ../drivers/vault-driver-removal.test.ts} — `git grep` over the
 * tracked tree must find zero hits (changelog history may still document the
 * rename; upgrade codemods may still rewrite the old tokens).
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

/** Forbidden compose env filename (legacy soft-compat). */
const FORBIDDEN_ENV_STACK = [".env.", "stack"].join("");
/** Forbidden env var — name avoids the contiguous token so this file is clean. */
const FORBIDDEN_LEGACY_ENV = ["OKE_", "STACK"].join("");
/** Forbidden vault helper. */
const FORBIDDEN_FROM_STACK = ["from", "Stack"].join("");

/**
 * Run `git grep -F` and assert zero matches after ignoring allow-listed paths.
 *
 * @param pattern - Fixed-string pattern
 * @param ignorePrefixes - Path prefixes to ignore (`path:line:` hits)
 */
function assertZeroGitGrep(pattern: string, ignorePrefixes: readonly string[] = []): void {
  const proc = Bun.spawnSync(["git", "grep", "-F", "-n", "-e", pattern, "--"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  // git grep exits 1 when there are no matches.
  if (proc.exitCode === 1) {
    expect(proc.stdout.toString()).toBe("");
    return;
  }
  const hits = proc.stdout
    .toString()
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .filter((line) => !ignorePrefixes.some((prefix) => line.startsWith(prefix)));
  expect(hits.join("\n")).toBe("");
}

describe("legacy stack-mode removal gate", () => {
  // `--stack` is first-class again (Swarm `docker-stack.yml` layout). Legacy
  // soft-compat was the env filename + vault helper surface — those stay forbidden.

  test("tracked tree has zero legacy compose env filename outside changelog", () => {
    assertZeroGitGrep(FORBIDDEN_ENV_STACK, ["changelog.md:"]);
  });

  test("tracked tree has zero legacy OKE env outside changelog", () => {
    assertZeroGitGrep(FORBIDDEN_LEGACY_ENV, ["changelog.md:"]);
  });

  test("tracked tree has zero legacy vault helper outside changelog + upgrade", () => {
    assertZeroGitGrep(FORBIDDEN_FROM_STACK, [
      "changelog.md:",
      "src/upgrade/codemods.ts:",
      "src/upgrade/codemods.test.ts:",
    ]);
  });
});
