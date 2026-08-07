/**
 * Local okengine staging for monorepo create-oke.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync } from "node:fs";
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
      exports?: Record<string, string>;
    };
    expect(pkg.name).toBe("okengine");
    expect(pkg.devDependencies).toBeUndefined();
    expect(pkg.workspaces).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
    expect(pkg.dependencies?.["oxc-parser"]).toBeDefined();
    // Peers folded into dependencies so the out-of-tree stage can resolve them.
    expect(pkg.dependencies?.["drizzle-orm"]).toBe("1.0.0-rc.4");
    expect(pkg.dependencies?.["drizzle-kit"]).toBe("1.0.0-rc.4");
    expect(pkg.dependencies?.["zod"]).toBeDefined();
    expect(pkg.exports?.["./config"]).toBe("./src/config/index.ts");

    // Real copies — Bun file: install drops directory symlinks.
    const src = join(stage, "src");
    expect(existsSync(src)).toBe(true);
    expect(lstatSync(src).isSymbolicLink()).toBe(false);
    expect(existsSync(join(stage, "src/config/index.ts"))).toBe(true);
    expect(existsSync(join(stage, "node_modules", "zod"))).toBe(true);
    expect(existsSync(join(stage, "node_modules", "drizzle-kit", "cli.mjs"))).toBe(true);
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
