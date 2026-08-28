/**
 * Gate: named competitor comparisons stay gone from the tracked tree.
 *
 * Mirrors {@link ./doc-staleness.test.ts} — `git grep` must find zero hits
 * (the headers decoy header fixture may still use a common
 * `X-Powered-By` value; that path is allow-listed).
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

/** Forbidden peer name — split so this file does not match itself. */
const FORBIDDEN_HONO = ["Ho", "no"].join("");
/** Forbidden peer name. */
const FORBIDDEN_ELYSIA = ["Ely", "sia"].join("");
/** Forbidden peer name (covers Enc + ore.ts). */
const FORBIDDEN_ENCORE = ["Enc", "ore"].join("");
/** Forbidden peer name. */
const FORBIDDEN_NESTJS = ["Nest", "JS"].join("");
/** Forbidden peer name. */
const FORBIDDEN_FASTIFY = ["Fast", "ify"].join("");
/** Forbidden peer site — avoid bare `iii` (matches lockfile hashes). */
const FORBIDDEN_III_DEV = ["iii", ".", "dev"].join("");
/** Deleted Comparison page path residue. */
const FORBIDDEN_COMPARISON_PATH = ["get-started/", "comparison"].join("");
/** Word-boundary classic Node framework — `-F` false-positives on `CallExpression`. */
const FORBIDDEN_EXPRESS = ["\\b", "Ex", "press", "\\b"].join("");
/** Compact-ID peer library (okid design context stays first-principles). */
const FORBIDDEN_NANOID = ["na", "no", "id"].join("");
/** Collision-resistant-ID peer library (same rule). */
const FORBIDDEN_CUID = ["cu", "id2"].join("");

/** Decoy `X-Powered-By` fixture value in the headers plugin tests. */
const EXPRESS_ALLOW = ["src/plugins/headers.test.ts:"];

/**
 * Allow-listed paths where peer-name strings are sanctioned: the okid design
 * prompt, lockfile hashes, and the vendored Console dist bundle (Zod ships
 * string-format validators whose registered format names collide with peer
 * library names inside minified zod-core — vendor API identifiers, not
 * authored comparisons).
 */
const OKID_PROMPT_ALLOW = [
  "okid.md:",
  "bun.lock:",
  // Minified zod-core inside the vendored Console bundle registers string
  // format validators whose names collide with peer library names — vendor
  // identifiers, not authored comparisons. Hash changes on Console rebuilds.
  "src/console/ui-next/dist/",
];

/**
 * Run `git grep -F` and assert zero matches after ignoring allow-listed paths.
 *
 * @param pattern - Fixed-string pattern
 * @param ignorePrefixes - Path prefixes to ignore (`path:line:` hits)
 */
function assertZeroGitGrepFixed(pattern: string, ignorePrefixes: readonly string[] = []): void {
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

/**
 * Run `git grep` with a basic regex and assert zero matches after allow-list.
 *
 * @param pattern - Basic regex (no `-F`)
 * @param ignorePrefixes - Path prefixes to ignore (`path:line:` hits)
 */
function assertZeroGitGrepRegex(pattern: string, ignorePrefixes: readonly string[] = []): void {
  const proc = Bun.spawnSync(["git", "grep", "-n", "-e", pattern, "--"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
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

describe("named competitor mention removal gate", () => {
  test("tracked tree has zero mentions of the thin multi-runtime router peer", () => {
    assertZeroGitGrepFixed(FORBIDDEN_HONO);
  });

  test("tracked tree has zero mentions of the Bun-first peer framework", () => {
    assertZeroGitGrepFixed(FORBIDDEN_ELYSIA);
  });

  test("tracked tree has zero mentions of the Rust-core peer platform", () => {
    assertZeroGitGrepFixed(FORBIDDEN_ENCORE);
  });

  test("tracked tree has zero mentions of the decorator DI peer", () => {
    assertZeroGitGrepFixed(FORBIDDEN_NESTJS);
  });

  test("tracked tree has zero mentions of the Node HTTP peer", () => {
    assertZeroGitGrepFixed(FORBIDDEN_FASTIFY);
  });

  test("tracked tree has zero mentions of the polyglot peer site host", () => {
    assertZeroGitGrepFixed(FORBIDDEN_III_DEV);
  });

  test("tracked tree has zero deleted Comparison path residue", () => {
    assertZeroGitGrepFixed(FORBIDDEN_COMPARISON_PATH);
  });

  test("tracked tree has zero classic Node framework peer mentions outside decoy fixture", () => {
    assertZeroGitGrepRegex(FORBIDDEN_EXPRESS, EXPRESS_ALLOW);
  });

  test("tracked tree has zero compact-ID peer library mentions outside design prompt", () => {
    assertZeroGitGrepFixed(FORBIDDEN_NANOID, OKID_PROMPT_ALLOW);
  });

  test("tracked tree has zero collision-resistant-ID peer library mentions outside design prompt", () => {
    assertZeroGitGrepFixed(FORBIDDEN_CUID, OKID_PROMPT_ALLOW);
  });
});
