/**
 * Local okengine staging for monorepo create-oke.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { localOkengineStageDir, materializeLocalOkengineDependency } from "./local-okengine.ts";
import { resolveLocalOkengineRoot } from "./templates.ts";
import { resolveOkengineDependency } from "./transform.ts";

describe("materializeLocalOkengineDependency", () => {
  test("stages publish-shaped package without workspaces or devDependencies", () => {
    const root = resolveLocalOkengineRoot();
    expect(root).not.toBeNull();
    if (!root) return;

    const dep = materializeLocalOkengineDependency(root);
    const stage = localOkengineStageDir();
    expect(dep).toBe(`file:${stage}`);

    const pkg = JSON.parse(readFileSync(join(stage, "package.json"), "utf8")) as {
      name: string;
      dependencies?: Record<string, string>;
      devDependencies?: unknown;
      workspaces?: unknown;
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.name).toBe("okengine");
    expect(pkg.devDependencies).toBeUndefined();
    expect(pkg.workspaces).toBeUndefined();
    expect(pkg.dependencies?.["oxc-parser"]).toBeDefined();
    expect(pkg.peerDependencies?.["drizzle-orm"]).toBeDefined();

    const src = join(stage, "src");
    expect(existsSync(src)).toBe(true);
    expect(lstatSync(src).isSymbolicLink()).toBe(true);
    expect(readlinkSync(src)).toBe(join(root, "src"));
  });

  test("resolveOkengineDependency uses the staged file: path locally", () => {
    const root = resolveLocalOkengineRoot();
    expect(root).not.toBeNull();
    if (!root) return;

    const dep = resolveOkengineDependency(root);
    expect(dep).toBe(`file:${localOkengineStageDir()}`);
    expect(dep).not.toBe(`file:${root}`);
  });
});
