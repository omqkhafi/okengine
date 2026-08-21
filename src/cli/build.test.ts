/**
 * `oke build` regenerates `src/flows/generated.ts` before bundling — real
 * before/after proof, not an assumption about the wiring.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBuild } from "./build.ts";

async function makeUnit(root: string, name: string): Promise<void> {
  const dir = join(root, "src/flows", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.ts"), "export const nothing = 1;\n");
}

describe("oke build — .adopt() barrel regeneration", () => {
  test("real before/after: no generated.ts before build, real barrel content after", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-build-adopt-"));
    try {
      await makeUnit(root, "main");
      await makeUnit(root, "notes");

      const generatedPath = join(root, "src/flows/generated.ts");
      await expect(readFile(generatedPath, "utf8")).rejects.toThrow();

      const code = await runBuild({
        rootDir: root,
        bundle: async () => ({ success: true, logs: "" }),
      });
      expect(code).toBe(0);

      const after = await readFile(generatedPath, "utf8");
      expect(after).toContain('import * as main from "./main/index.ts";');
      expect(after).toContain('import * as notes from "./notes/index.ts";');
      expect(after).toContain("export { main }");
      expect(after).toContain("export { notes }");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("regeneration runs before bundling, using the injected syncAdoptBarrel", async () => {
    const calls: string[] = [];
    const code = await runBuild({
      rootDir: "/fake/root",
      syncAdoptBarrel: async (rootDir) => {
        calls.push(`sync:${rootDir}`);
        return ["main", "notes"];
      },
      bundle: async () => {
        calls.push("bundle");
        return { success: true, logs: "" };
      },
    });
    expect(code).toBe(0);
    expect(calls).toEqual(["sync:/fake/root", "bundle"]);
  });

  test("bundle failure still returns non-zero after a successful sync", async () => {
    const code = await runBuild({
      rootDir: "/fake/root",
      syncAdoptBarrel: async () => [],
      bundle: async () => ({ success: false, logs: "boom" }),
    });
    expect(code).toBe(1);
  });
});
