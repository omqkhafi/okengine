/**
 * CodeLens formatting + real extractor against examples/notes.
 */

import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { SourceFile } from "../../../src/compiler/extract.ts";
import { lensesForFile } from "./extract-bridge.ts";
import { formatEffectsCodeLens } from "./format-effects.ts";

describe("formatEffectsCodeLens", () => {
  test("matches doc-comment style", () => {
    expect(
      formatEffectsCodeLens({
        reads: ["sql:notes"],
        writes: ["sql:notes"],
      }),
    ).toBe("effects → reads[sql:notes], writes[sql:notes]");
  });

  test("omits empty keys", () => {
    expect(formatEffectsCodeLens({ writes: ["sql:notes"] })).toBe(
      "effects → writes[sql:notes]",
    );
    expect(formatEffectsCodeLens({})).toBeUndefined();
  });
});

describe("lensesForFile — examples/notes", () => {
  test("create/list show writes/reads CodeLens titles", async () => {
    const notesRoot = join(import.meta.dir, "../../../examples/notes");
    const files = await loadNotesSources(notesRoot);
    const lenses = await lensesForFile("src/flows/notes/index.ts", files);

    const byId = Object.fromEntries(lenses.map((l) => [l.flowId, l]));
    expect(byId.create?.title).toBe("effects → writes[sql:notes]");
    expect(byId.list?.title).toBe("effects → reads[sql:notes]");
    expect(byId.create?.line).toBe(13);
  });
});

/**
 * @param notesRoot - examples/notes absolute path
 */
async function loadNotesSources(notesRoot: string): Promise<SourceFile[]> {
  const paths: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const name of await readdir(dir, { withFileTypes: true })) {
      if (name.name === "node_modules") continue;
      const full = join(dir, name.name);
      if (name.isDirectory()) await walk(full);
      else if (/\.tsx?$/.test(name.name) && !name.name.endsWith(".test.ts")) {
        paths.push(full);
      }
    }
  }
  await walk(notesRoot);
  const files: SourceFile[] = [];
  for (const full of paths) {
    files.push({
      path: relative(notesRoot, full).replace(/\\/g, "/"),
      source: await Bun.file(full).text(),
    });
  }
  return files;
}
