/**
 * Gate: Copy Markdown / content.md routes must match on-disk source bodies.
 */

import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  DOCS_CONTENT_DIR,
  readDocsSourceBody,
  stripYamlFrontmatter,
} from "./markdown-source";

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listMarkdownFiles(abs)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(abs);
    }
  }
  return out;
}

describe("docs markdown source identity", () => {
  test("stripYamlFrontmatter removes only the leading frontmatter block", () => {
    const raw = `---
title: "Hi"
---

# Body

text
`;
    expect(stripYamlFrontmatter(raw)).toBe("# Body\n\ntext\n");
  });

  test("every content/docs page body equals stripYamlFrontmatter(file)", async () => {
    const files = await listMarkdownFiles(DOCS_CONTENT_DIR);
    expect(files.length).toBeGreaterThan(10);

    for (const abs of files) {
      const relative = abs.slice(DOCS_CONTENT_DIR.length + 1);
      const raw = await readFile(abs, "utf8");
      const expected = stripYamlFrontmatter(raw);
      const actual = await readDocsSourceBody(relative);
      expect(actual).toBe(expected);
      expect(actual.startsWith("---\n")).toBe(false);
      expect(actual.length).toBeGreaterThan(0);
    }
  });
});
