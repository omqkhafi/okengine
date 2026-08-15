/**
 * XSS build gate — no `dangerouslySetInnerHTML` / raw HTML injection in Console UI.
 *
 * console §10.2: this is a build gate, not a review convention.
 *
 * The scan walks `src/console/ui-next/src` recursively. The feature-directory
 * assertion fails the build if a new `features/<name>` folder appears without
 * being covered by that walk.
 */

import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const UI_ROOT = `${import.meta.dir}/ui-next/src`;
const FEATURES_ROOT = `${UI_ROOT}/features`;

/**
 * Feature directories that must be covered by the XSS scan today.
 * Update this list when a new Console module lands — the recursive walk
 * already covers it; the list makes coverage explicit in CI output.
 */
export const CONSOLE_UI_FEATURE_DIRS = [
  "auth",
  "flows",
  "setup",
  "store",
  "units",
  "vault",
] as const;

/** Patterns that fail the gate. */
const FORBIDDEN = [
  /dangerouslySetInnerHTML/,
  /\.innerHTML\s*=/,
  /document\.write\s*\(/,
  /insertAdjacentHTML\s*\(/,
];

/**
 * Collect source files under the Console UI.
 *
 * @param dir - Directory
 */
async function collectSources(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      out.push(...(await collectSources(path)));
      continue;
    }
    if (/\.(tsx?|jsx?|html|css)$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Scan source text for forbidden XSS sinks.
 *
 * @param text - Source
 */
export function findXssViolations(text: string): string[] {
  return FORBIDDEN.filter((pattern) => pattern.test(text)).map(String);
}

describe("console XSS gate", () => {
  test("scan glob covers every features/<module> directory that exists today", async () => {
    const entries = await readdir(FEATURES_ROOT, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(dirs).toEqual([...CONSOLE_UI_FEATURE_DIRS].sort());

    const files = await collectSources(UI_ROOT);
    for (const feature of CONSOLE_UI_FEATURE_DIRS) {
      const hit = files.some(
        (f) => f.includes(`/features/${feature}/`) || f.includes(`\\features\\${feature}\\`),
      );
      expect(hit).toBe(true);
    }
  });

  test("no dangerouslySetInnerHTML or raw HTML sinks in Console UI", async () => {
    const files = await collectSources(UI_ROOT);
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      const text = await Bun.file(file).text();
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) {
          violations.push(`${file}: ${pattern}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("gate fails a PR that introduces raw HTML", () => {
    const bad = `export function Evil() { return <div dangerouslySetInnerHTML={{ __html: x }} />; }`;
    expect(findXssViolations(bad).length).toBeGreaterThan(0);
    expect(findXssViolations(`el.innerHTML = payload`)).toContain(String(/\.innerHTML\s*=/));
  });
});
