/**
 * Gate: scaffold all clean templates (+ teaching examples) into a temp
 * directory, run `bun install` + `bun test` in each, and assert pass.
 *
 * Opt-in via `CREATE_OKE_INTEGRATION=1` so root `bun test` / local `bun run ci`
 * stay fast. Enabled on GitHub Actions via the `test` job env.
 */

import { describe, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXAMPLES, TEMPLATES } from "../src/templates.ts";
import { assertSourceWorks, INSTALL_TIMEOUT_MS, TEST_TIMEOUT_MS } from "./scaffold-gate.ts";

const ENABLED = process.env["CREATE_OKE_INTEGRATION"] === "1";

describe.skipIf(!ENABLED)("create-oke integration", () => {
  test(
    "scaffolds hello|minimal|standard|full · bun install · bun test",
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
