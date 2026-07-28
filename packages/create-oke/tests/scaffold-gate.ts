/**
 * Shared create-oke scaffold gate helpers (install + test in a temp app).
 */

import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scaffold, type ScaffoldSource } from "../src/scaffold.ts";

/** Per-source install budget. */
export const INSTALL_TIMEOUT_MS = 120_000;
/** Per-source test budget. */
export const TEST_TIMEOUT_MS = 120_000;

/**
 * Scaffold one source and prove install + tests pass.
 *
 * @param root - Shared temp parent
 * @param source - Template or example
 */
export async function assertSourceWorks(root: string, source: ScaffoldSource): Promise<void> {
  const id = source.id;
  const name = `app-${id}`;
  const targetDir = join(root, name);
  const result = scaffold({ targetDir, name, source });

  const pkg = JSON.parse(readFileSync(join(targetDir, "package.json"), "utf8")) as {
    dependencies: { okengine: string };
  };

  expect(pkg.dependencies.okengine).not.toBe("file:../..");
  expect(
    pkg.dependencies.okengine.startsWith("file:") ||
      /^\d+\.\d+\.\d+/.test(pkg.dependencies.okengine),
  ).toBe(true);
  expect(result.files).toContain("oke.config.ts");
  expect(result.files).toContain("src/app.ts");

  const install = Bun.spawn(["bun", "install"], {
    cwd: targetDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const installCode = await install.exited;
  if (installCode !== 0) {
    const installErr = await new Response(install.stderr).text();
    throw new Error(`bun install failed for ${id}: ${installErr}`);
  }

  const testProc = Bun.spawn(["bun", "test"], {
    cwd: targetDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const testCode = await testProc.exited;
  if (testCode !== 0) {
    const testOut = await new Response(testProc.stdout).text();
    const testErr = await new Response(testProc.stderr).text();
    throw new Error(`bun test failed for ${id}:\n${testOut}\n${testErr}`);
  }
  expect(testCode).toBe(0);
}
