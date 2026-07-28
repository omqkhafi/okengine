/**
 * Codemod registry integrity — stability contract §22.
 */

import { describe, expect, test } from "bun:test";
import {
  CODEMODS,
  rewriteConfigEnvKeys,
  rewriteFromStackMarkers,
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

  test("rewriteConfigEnvKeys renames driver-map keys", () => {
    const after = rewriteConfigEnvKeys(`sql: {
  dev: "sqlite",
  stack: "postgres",
  prod: "postgres",
}`);
    expect(after).toContain('local: "sqlite"');
    expect(after).toContain('docker: "postgres"');
    expect(after).not.toMatch(/(^|[^\w.])dev\s*:/);
    expect(after).not.toMatch(/(^|[^\w.])stack\s*:/);
  });

  test("rewriteFromStackMarkers renames vault helpers", () => {
    const after = rewriteFromStackMarkers(
      `dev: vault.fromStack("store.sql") // __oke_from_stack__`,
    );
    expect(after).toContain("fromDocker");
    expect(after).toContain("__oke_from_docker__");
    expect(after).not.toContain("fromStack");
  });
});
