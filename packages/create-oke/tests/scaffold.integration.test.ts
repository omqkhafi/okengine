/**
 * Gate: scaffold the standard starter into a temp directory, run
 * `bun install` + `bun test`, and assert pass.
 *
 * Opt-in via `CREATE_OKE_INTEGRATION=1` so plain `bun test` stays fast.
 * Enabled by local `bun run ci` and the GitHub Actions `test` job.
 */

import { describe, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEMPLATES } from "../src/templates.ts";
import { assertSourceWorks, INSTALL_TIMEOUT_MS, TEST_TIMEOUT_MS } from "./scaffold-gate.ts";

const ENABLED = process.env["CREATE_OKE_INTEGRATION"] === "1";

describe.skipIf(!ENABLED)("create-oke integration", () => {
  test(
    "scaffolds standard · bun install · bun test",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "create-oke-gate-"));
      try {
        for (const template of TEMPLATES) {
          await assertSourceWorks(root, { kind: "template", id: template });
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    INSTALL_TIMEOUT_MS * TEMPLATES.length + TEST_TIMEOUT_MS * TEMPLATES.length,
  );
});
