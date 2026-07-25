/**
 * Continuous audit copy tests (console §9.7).
 */

import { describe, expect, test } from "bun:test";
import { auditLines, formatViolation } from "./audit.ts";
import { GATES_LIST_FIXTURE } from "./fixture.ts";

describe("auditLines", () => {
  test("surfaces unguarded, orphans, empty roles, unattached", () => {
    const lines = auditLines(GATES_LIST_FIXTURE.audit);
    expect(lines.map((l) => l.code)).toEqual([
      "unguarded",
      "orphan-permissions",
      "empty-roles",
      "unattached",
    ]);
    expect(lines[0]?.message).toContain("unguarded");
  });

  test("empty audit yields no lines", () => {
    expect(
      auditLines({
        unguardedFlows: [],
        orphanPermissions: [],
        emptyRoles: [],
        unattachedGates: [],
      }),
    ).toEqual([]);
  });
});

describe("formatViolation", () => {
  test("never looks like a normal principal row", () => {
    const text = formatViolation(GATES_LIST_FIXTURE.violations[0]!);
    expect(text).toContain("application scope");
    expect(text).toContain("booking:create");
    expect(text).toContain("bad@example.com");
  });
});
