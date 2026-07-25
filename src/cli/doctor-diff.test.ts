/**
 * `oke doctor --diff` — undeclared contract-break CI gate.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Manifest } from "../manifest/types.ts";
import { parseManifest } from "../manifest/validate.ts";
import { runDoctorDiff } from "./doctor-diff.ts";

const baseUrl = new URL(
  "../manifest/fixtures/base.manifest.json",
  import.meta.url,
);

async function loadBase(): Promise<Manifest> {
  return parseManifest(await Bun.file(baseUrl).text());
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("oke doctor --diff", () => {
  test("ok when manifests are identical", async () => {
    const m = await loadBase();
    const logs: string[] = [];
    const { code, undeclared } = await runDoctorDiff({
      before: m,
      after: clone(m),
      write: (t) => logs.push(t),
    });
    expect(code).toBe(0);
    expect(undeclared).toHaveLength(0);
    expect(logs.join("")).toContain("ok");
  });

  test("fails on undeclared contract break", async () => {
    const before = await loadBase();
    const after = clone(before);
    const errors = after.flows!["reports.export"]!.errors;
    after.flows!["reports.export"]!.errors = Array.isArray(errors)
      ? errors.filter((e) => e !== "Forbidden")
      : errors;
    const { code, undeclared } = await runDoctorDiff({
      before,
      after,
      write: () => {},
    });
    expect(code).toBe(1);
    expect(undeclared.length).toBeGreaterThan(0);
  });

  test("passes when break is acknowledged with breaking: true", async () => {
    const before = await loadBase();
    const after = clone(before);
    const errors = after.flows!["reports.export"]!.errors;
    after.flows!["reports.export"]!.errors = Array.isArray(errors)
      ? errors.filter((e) => e !== "Forbidden")
      : errors;
    after.flows!["reports.export"]!.breaking = true;
    const { code } = await runDoctorDiff({
      before,
      after,
      write: () => {},
    });
    expect(code).toBe(0);
  });

  test("explicit --before/--after paths", async () => {
    const before = await loadBase();
    const after = clone(before);
    const dir = `${tmpdir()}/oke-doctor-diff-${crypto.randomUUID()}`;
    await mkdir(dir, { recursive: true });
    await Bun.write(`${dir}/before.json`, JSON.stringify(before));
    await Bun.write(`${dir}/after.json`, JSON.stringify(after));
    try {
      const { code } = await runDoctorDiff({
        cwd: dir,
        beforePath: "before.json",
        afterPath: "after.json",
        write: () => {},
      });
      expect(code).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

