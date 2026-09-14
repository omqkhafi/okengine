/**
 * Unit tests for create-oke abort cleanup (wipe only an uncommitted new folder).
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldWipeNewProject, wipeNewProjectDir } from "./cleanup.ts";

describe("shouldWipeNewProject", () => {
  test("wipes only a folder this process created, before scaffold commits", () => {
    expect(shouldWipeNewProject(false, false)).toBe(true);
    expect(shouldWipeNewProject(false, true)).toBe(false);
    expect(shouldWipeNewProject(true, false)).toBe(false);
    expect(shouldWipeNewProject(true, true)).toBe(false);
  });
});

describe("wipeNewProjectDir", () => {
  test("removes a tree and is a no-op when missing", () => {
    const root = mkdtempSync(join(tmpdir(), "create-oke-wipe-"));
    const nested = join(root, "app");
    mkdirSync(nested);
    writeFileSync(join(nested, "oke.config.ts"), "export default {};\n");
    try {
      wipeNewProjectDir(nested);
      expect(existsSync(nested)).toBe(false);
      wipeNewProjectDir(join(root, "gone"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
