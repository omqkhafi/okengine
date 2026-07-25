/**
 * Oxc node:/bun: bypass scan.
 */

import { describe, expect, test } from "bun:test";
import { scanNodeImportsBypassingFx } from "./node-import-scan.ts";

describe("scanNodeImportsBypassingFx", () => {
  test("detects static node: imports", () => {
    const findings = scanNodeImportsBypassingFx([
      {
        path: "evil.ts",
        source: `import fs from "node:fs";\nexport const x = fs;\n`,
      },
    ]);
    expect(findings.some((f) => f.specifier === "node:fs")).toBe(true);
  });

  test("ignores relative imports", () => {
    const findings = scanNodeImportsBypassingFx([
      {
        path: "ok.ts",
        source: `import { foo } from "./foo.ts";\nexport { foo };\n`,
      },
    ]);
    expect(findings).toEqual([]);
  });
});
