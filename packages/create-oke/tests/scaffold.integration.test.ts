/**
 * Gate: scaffold all clean templates (+ one teaching example) into a temp
 * directory, run `bun install` + `bun test` in each, and assert pass.
 *
 * Opt-in via `CREATE_OKE_INTEGRATION=1` so root `bun test` stays fast.
 * Invoked by `bun run test:create-oke`.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold, type ScaffoldSource } from "../src/scaffold.ts";
import { EXAMPLES, TEMPLATES, type ExampleId, type TemplateId } from "../src/templates.ts";

const ENABLED = process.env["CREATE_OKE_INTEGRATION"] === "1";
const INSTALL_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 120_000;

describe.skipIf(!ENABLED)("create-oke integration", () => {
  test(
    "scaffolds hello|minimal|standard|full · bun install · bun test",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "create-oke-gate-"));
      try {
        for (const template of TEMPLATES) {
          await assertSourceWorks(root, {
            kind: "template",
            id: template,
          });
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    INSTALL_TIMEOUT_MS * TEMPLATES.length + TEST_TIMEOUT_MS * TEMPLATES.length,
  );

  test(
    "scaffolds --from-example notes|linkly|provisions|skyport · bun install · bun test",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "create-oke-examples-gate-"));
      try {
        for (const example of EXAMPLES) {
          await assertSourceWorks(root, { kind: "example", id: example });
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    INSTALL_TIMEOUT_MS * EXAMPLES.length + TEST_TIMEOUT_MS * EXAMPLES.length,
  );
});

/**
 * Scaffold one source and prove install + tests pass.
 *
 * @param root - Shared temp parent
 * @param source - Template or example
 */
async function assertSourceWorks(
  root: string,
  source: ScaffoldSource,
): Promise<void> {
  const id = source.id;
  const name = `app-${id}`;
  const targetDir = join(root, name);
  const result = scaffold({ targetDir, name, source });

  const pkg = JSON.parse(
    readFileSync(join(targetDir, "package.json"), "utf8"),
  ) as { dependencies: { okengine: string } };

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

  // Keep TypeScript happy for TemplateId / ExampleId exhaustiveness in callers.
  void (id as TemplateId | ExampleId);
}
