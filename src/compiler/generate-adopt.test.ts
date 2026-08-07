/**
 * `.adopt()` barrel generator — real filesystem before/after proofs.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateAdoptBarrel } from "./generate-adopt.ts";

async function makeUnit(root: string, name: string, withIndex = true): Promise<void> {
  const dir = join(root, "src/flows", name);
  await mkdir(dir, { recursive: true });
  if (withIndex) await writeFile(join(dir, "index.ts"), "export const nothing = 1;\n");
}

describe("generateAdoptBarrel", () => {
  test("emits one `export * as <unit>` per flows folder with an index.ts barrel", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-adopt-gen-"));
    try {
      await makeUnit(root, "notes");
      await makeUnit(root, "main");
      const result = await generateAdoptBarrel({ rootDir: root });
      expect(result.units).toEqual(["main", "notes"]);
      expect(result.source).toContain('export * as main from "./main/index.ts";');
      expect(result.source).toContain('export * as notes from "./notes/index.ts";');
      expect(result.skipped).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("skips a unit folder with no index.ts barrel (never crashes)", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-adopt-gen-"));
    try {
      await makeUnit(root, "notes");
      await makeUnit(root, "scratch", false);
      const result = await generateAdoptBarrel({ rootDir: root });
      expect(result.units).toEqual(["notes"]);
      expect(result.skipped).toEqual(["scratch"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("missing flows directory yields an empty barrel, never throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-adopt-gen-"));
    try {
      const result = await generateAdoptBarrel({ rootDir: root });
      expect(result.units).toEqual([]);
      expect(result.source).toContain("AUTO-GENERATED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("real before/after: generated barrel matches the hand-written form it replaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-adopt-gen-"));
    try {
      await mkdir(join(root, "src/flows/main"), { recursive: true });
      await mkdir(join(root, "src/flows/notes"), { recursive: true });
      await writeFile(join(root, "src/flows/main/index.ts"), 'export const root = "main-flow";\n');
      await writeFile(
        join(root, "src/flows/notes/index.ts"),
        'export const create = "notes-flow";\n',
      );
      const result = await generateAdoptBarrel({ rootDir: root });
      const generatedPath = join(root, "src/flows/generated.ts");
      await writeFile(generatedPath, result.source);

      // Same shape as `import * as main from "./flows/main"; import * as
      // notes from "./flows/notes"; .adopt({ main, notes })` — a namespace
      // object keyed by unit, one key per flows folder, real modules loaded.
      const generatedModule = (await import(generatedPath)) as {
        main: { root: string };
        notes: { create: string };
      };
      expect(Object.keys(generatedModule).sort()).toEqual(["main", "notes"]);
      expect(generatedModule.main.root).toBe("main-flow");
      expect(generatedModule.notes.create).toBe("notes-flow");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
