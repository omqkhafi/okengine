/**
 * `.adopt()` barrel generator — real filesystem before/after proofs.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importSpecifierFromWalked } from "./flow-path.ts";
import { generateAdoptBarrel, GenerateAdoptError, writeAdoptBarrel } from "./generate-adopt.ts";

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
      expect(result.source).toContain('import * as main from "./main/index.ts";');
      expect(result.source).toContain('import * as notes from "./notes/index.ts";');
      expect(result.source).toContain("export { main };");
      expect(result.source).toContain("export { notes };");
      expect(result.source).toContain("registerFlowUnits({ main, notes })");
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
      await mkdir(join(root, "node_modules/okengine"), { recursive: true });
      await writeFile(
        join(root, "node_modules/okengine/package.json"),
        JSON.stringify({ name: "okengine", type: "module", exports: "./index.ts" }),
      );
      await writeFile(
        join(root, "node_modules/okengine/index.ts"),
        "export function registerFlowUnits() {}\n",
      );
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

  test("tree unit synthesizes a namespace and POSIX-quoted [id] imports", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-adopt-gen-"));
    try {
      const getDir = join(root, "src/flows/notes/[id]");
      await mkdir(getDir, { recursive: true });
      await writeFile(
        join(root, "src/flows/notes/list.ts"),
        'export const list = { name: "notes.list" };\n',
      );
      await writeFile(join(getDir, "get.ts"), 'export const get = { name: "notes.get" };\n');
      const result = await generateAdoptBarrel({ rootDir: root });
      expect(result.units).toEqual(["notes"]);
      expect(result.source).toContain('from "./notes/[id]/get.ts"');
      expect(result.source).toContain('from "./notes/list.ts"');
      expect(result.source.includes("\\")).toBe(false);
      expect(result.source).toContain("stampHttpPath");
      expect(result.source).toContain('"/notes/:id"');
      expect(result.source).toContain('"/notes"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("mixed barrel index.ts + tree files is a generate error", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-adopt-gen-"));
    try {
      await mkdir(join(root, "src/flows/notes/[id]"), { recursive: true });
      await writeFile(join(root, "src/flows/notes/index.ts"), "export const list = 1;\n");
      await writeFile(join(root, "src/flows/notes/[id]/get.ts"), "export const get = 1;\n");
      await expect(generateAdoptBarrel({ rootDir: root })).rejects.toBeInstanceOf(GenerateAdoptError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("two files exporting the same name is a generate error", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-adopt-gen-"));
    try {
      await mkdir(join(root, "src/flows/notes"), { recursive: true });
      await writeFile(join(root, "src/flows/notes/list.ts"), "export const get = 1;\n");
      await writeFile(join(root, "src/flows/notes/route.ts"), "export const get = 2;\n");
      await expect(generateAdoptBarrel({ rootDir: root })).rejects.toThrow(/exports "get"/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("flow('tasks.get') under notes/ is a generate error", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-adopt-gen-"));
    try {
      await mkdir(join(root, "src/flows/notes"), { recursive: true });
      await writeFile(
        join(root, "src/flows/notes/get.ts"),
        'export const get = flow("tasks.get", { do: () => 1 });\n',
      );
      await expect(generateAdoptBarrel({ rootDir: root })).rejects.toThrow(/does not match the folder/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("writeAdoptBarrel skips identical bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-adopt-gen-"));
    try {
      await mkdir(join(root, "src/flows"), { recursive: true });
      const source = "// same\n";
      expect((await writeAdoptBarrel(root, source)).written).toBe(true);
      expect((await writeAdoptBarrel(root, source)).written).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("import specifiers stay POSIX when the walked path used backslash", () => {
    const spec = importSpecifierFromWalked("notes\\[id]\\get.ts");
    expect(spec).toBe("./notes/[id]/get.ts");
    expect(spec.includes("\\")).toBe(false);
  });

  test("[...slug] unit adds the * client-key comment", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-adopt-gen-"));
    try {
      await mkdir(join(root, "src/flows/docs/[...slug]"), { recursive: true });
      await writeFile(join(root, "src/flows/docs/[...slug]/get.ts"), "export const get = 1;\n");
      const result = await generateAdoptBarrel({ rootDir: root });
      expect(result.source).toContain('Catch-all param is "*"');
      expect(result.source).toContain('from "./docs/[...slug]/get.ts"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
