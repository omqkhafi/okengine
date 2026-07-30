/**
 * Gate: redesigned docs surfaces must not regress into prose walls.
 * Max N consecutive plain paragraph lines without a structural break.
 */

import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DOCS_CONTENT_DIR, stripYamlFrontmatter } from "./markdown-source";

const MAX_CONSECUTIVE = 3;

const STRUCTURAL =
  /^(<(Cards|Card|Callout|Tabs|Tab|TypeTable|Features|Steps|Step|Accordions?)\b|```|#{1,6} |\||\w+="|[/]?>$)/;

/**
 * Whether a non-empty line counts as a plain prose paragraph line.
 *
 * @param line - Body line
 */
function isPlainParagraph(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (STRUCTURAL.test(t)) return false;
  if (/^[-*+] /.test(t) || /^\d+\. /.test(t)) return false;
  if (t.startsWith(">") || t.startsWith("</")) return false;
  if (t === "---") return false;
  return true;
}

/**
 * List MDX files under a relative docs folder.
 *
 * @param rel - Path under content/docs
 */
async function listMdx(rel: string): Promise<string[]> {
  const dir = join(DOCS_CONTENT_DIR, rel);
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".mdx")) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Max consecutive plain paragraph lines in a body (skips fenced code).
 *
 * @param body - Frontmatter-stripped MDX
 */
function maxConsecutivePlain(body: string): number {
  let run = 0;
  let max = 0;
  let inFence = false;
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      run = 0;
      continue;
    }
    if (inFence) {
      run = 0;
      continue;
    }
    if (isPlainParagraph(line)) {
      run += 1;
      if (run > max) max = run;
    } else {
      run = 0;
    }
  }
  return max;
}

describe("docs prose density", () => {
  test(`index + elements + console + reference + plugins + ai MDX ≤ ${MAX_CONSECUTIVE} consecutive plain paragraphs`, async () => {
    const files = [
      join(DOCS_CONTENT_DIR, "index.mdx"),
      ...(await listMdx("elements")),
      ...(await listMdx("console")),
      ...(await listMdx("reference")),
      ...(await listMdx("plugins")),
      ...(await listMdx("ai")),
    ];
    expect(files.length).toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const abs of files) {
      const raw = await readFile(abs, "utf8");
      const body = stripYamlFrontmatter(raw);
      const n = maxConsecutivePlain(body);
      if (n > MAX_CONSECUTIVE) {
        const rel = abs.slice(DOCS_CONTENT_DIR.length + 1);
        offenders.push(`${rel}: ${n} consecutive plain lines`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
