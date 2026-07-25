/**
 * XSS build gate — no `dangerouslySetInnerHTML` / raw HTML injection in Console UI.
 *
 * console §10.2: this is a build gate, not a review convention.
 *
 * The scan walks all of `src/console/ui` recursively (not a hard-coded panel
 * list from Prompt 16). The panel-directory assertion below fails the build
 * if a new `ui/<panel>` folder appears without being covered by that walk.
 */

import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const UI_ROOT = `${import.meta.dir}/ui`;

/**
 * Panel feature directories that must be covered by the XSS scan today.
 * Update this list when a 18th panel lands — the recursive walk already
 * covers it; the list makes coverage explicit in CI output.
 */
export const CONSOLE_UI_PANEL_DIRS = [
  "access",
  "ai",
  "architecture",
  "channels",
  "clock",
  "diff",
  "flows",
  "gates",
  "overview",
  "plugins",
  "runs",
  "signals",
  "store",
  "traces",
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
  test("scan glob covers every ui/<panel> directory that exists today", async () => {
    const entries = await readdir(UI_ROOT, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => name !== "dist" && name !== "shell" && name !== "node_modules")
      .sort();
    expect(dirs).toEqual([...CONSOLE_UI_PANEL_DIRS].sort());

    const files = await collectSources(UI_ROOT);
    for (const panel of CONSOLE_UI_PANEL_DIRS) {
      const hit = files.some((f) => f.includes(`/ui/${panel}/`) || f.includes(`\\ui\\${panel}\\`));
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
    expect(findXssViolations(`el.innerHTML = payload`)).toContain(
      String(/\.innerHTML\s*=/),
    );
  });
});
