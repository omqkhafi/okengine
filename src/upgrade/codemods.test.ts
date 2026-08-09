/**
 * Codemod registry integrity — stability contract §22.
 */

import { describe, expect, test } from "bun:test";
import {
  CODEMODS,
  rewriteThinRootImports,
  runCodemods,
  validateCodemodRegistry,
  type Codemod,
} from "./codemods.ts";

describe("codemod registry", () => {
  test("built-in registry is valid", () => {
    expect(validateCodemodRegistry(CODEMODS)).toEqual([]);
  });

  test("detects duplicate ids and missing metadata", () => {
    const bad: Codemod[] = [
      {
        id: "dup",
        from: "0.1.0",
        to: "0.2.0",
        description: "first",
        apply: async () => [],
      },
      {
        id: "dup",
        from: "",
        to: "0.2.0",
        description: "",
        apply: async () => [],
      },
    ];
    const errors = validateCodemodRegistry(bad);
    expect(errors.some((e) => e.includes("duplicate"))).toBe(true);
    expect(errors.some((e) => e.includes("missing from"))).toBe(true);
    expect(errors.some((e) => e.includes("missing description"))).toBe(true);
  });

  test("runCodemods aggregates changes", async () => {
    const registry: Codemod[] = [
      {
        id: "demo",
        from: "0.0.0",
        to: "0.0.1",
        description: "rename demo",
        apply: async () => [{ path: "src/x.ts", before: "old", after: "new" }],
      },
    ];
    const changes = await runCodemods("/tmp", registry);
    expect(changes).toEqual([{ path: "src/x.ts", before: "old", after: "new" }]);
  });

  test("rewriteThinRootImports moves deep imports to subpaths", () => {
    const after = rewriteThinRootImports(
      `import { createFx, on } from "okengine";\nimport { flow } from "okengine";\n`,
    );
    expect(after).toContain('from "okengine/full"');
    expect(after).toContain("createFx");
    expect(after).toMatch(/from ["']okengine["']/);
  });
});
