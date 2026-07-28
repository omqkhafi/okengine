/**
 * Undeclared contract-break filter — console §9.12 CI gate.
 */

import { describe, expect, test } from "bun:test";
import type { Flow, Manifest } from "./types.ts";
import { undeclaredContractBreaks } from "./undeclared.ts";
import { parseManifest } from "./validate.ts";

const baseUrl = new URL("./fixtures/base.manifest.json", import.meta.url);

async function loadBase(): Promise<Manifest> {
  return parseManifest(await Bun.file(baseUrl).text());
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Remove a named error from a flow (array or map form). */
function removeError(flow: Flow, name: string): void {
  const errors = flow.errors;
  if (Array.isArray(errors)) {
    flow.errors = errors.filter((e) => e !== name);
  } else if (errors && typeof errors === "object") {
    const next = { ...errors };
    delete next[name];
    flow.errors = next;
  }
}

describe("undeclaredContractBreaks", () => {
  test("blocks contract-breaking changes without breaking: true", async () => {
    const before = await loadBase();
    const after = clone(before);
    removeError(after.flows!["reports.export"]!, "Forbidden");

    const undeclared = undeclaredContractBreaks(before, after);
    expect(undeclared.length).toBeGreaterThan(0);
    expect(undeclared.some((c) => c.path.includes("Forbidden"))).toBe(true);
  });

  test("allows contract breaks when the owning flow sets breaking: true", async () => {
    const before = await loadBase();
    const after = clone(before);
    removeError(after.flows!["reports.export"]!, "Forbidden");
    after.flows!["reports.export"]!.breaking = true;

    const undeclared = undeclaredContractBreaks(before, after);
    expect(undeclared.filter((c) => c.path.includes("reports.export"))).toHaveLength(0);
  });

  test("does not let one flow's breaking: true cover another flow", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.flows!["orders.create"]!.breaking = true;
    removeError(after.flows!["reports.export"]!, "Forbidden");

    const undeclared = undeclaredContractBreaks(before, after);
    expect(undeclared.length).toBeGreaterThan(0);
    expect(undeclared.some((c) => c.path.includes("reports.export"))).toBe(true);
    expect(undeclared.every((c) => !c.path.includes("orders.create"))).toBe(true);
  });

  test("flow removal is allowed when baseline had breaking: true", async () => {
    const before = await loadBase();
    before.flows!["orders.create"]!.breaking = true;
    const after = clone(before);
    delete after.flows!["orders.create"];

    const undeclared = undeclaredContractBreaks(before, after);
    expect(undeclared.filter((c) => c.path.includes("orders.create"))).toHaveLength(0);
  });
});
