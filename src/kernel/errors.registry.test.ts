/**
 * Error-code registry gate — unique codes, domain ranges, lazy discovery (§21).
 *
 * Docs pages (docs/e/{code}.md) are deferred to a dedicated docs prompt;
 * this gate enforces registry invariants only.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  OKE_ERROR_RANGES,
  OKE_ERRORS,
  OkeError,
  lookupOkeError,
  type OkeErrorDefinition,
} from "./errors.ts";
import { LIVE_RESUME_GAP } from "./errors-live-resume.ts";
import { CHANNEL_SCHEMA } from "./errors-channel.ts";
import { FLOW_NAME_DUPLICATE } from "./errors-flow-name.ts";
import { TENANT_NOT_MEMBER, TENANT_REQUIRED, TENANT_UNKNOWN_SCOPE } from "./errors-tenant.ts";
import {
  assertCodesInDomainRanges,
  assertUniqueCodes,
  discoverLazyErrorDefs,
  findDuplicateCodes,
  findOutOfRangeDefs,
} from "./errors.registry-helpers.ts";

const KERNEL_DIR = import.meta.dir;
const PROBE_FILE = "errors-__probe__.ts";
const PROBE_PATH = join(KERNEL_DIR, PROBE_FILE);

describe("OKE error-code registry", () => {
  test("every code is unique across main + discovered lazy defs", async () => {
    const { defs: lazy } = await discoverLazyErrorDefs(KERNEL_DIR);
    const all = [...Object.values(OKE_ERRORS), ...lazy];
    expect(findDuplicateCodes(all)).toEqual([]);
    assertUniqueCodes(all);
  });

  test("every code falls within its declared domain range", async () => {
    const { defs: lazy } = await discoverLazyErrorDefs(KERNEL_DIR);
    const all = [...Object.values(OKE_ERRORS), ...lazy];
    expect(findOutOfRangeDefs(all)).toEqual([]);
    assertCodesInDomainRanges(all);
  });

  test("OKE_ERROR_RANGES matches the locked domain scheme", () => {
    expect(OKE_ERROR_RANGES.kernel).toEqual([1000, 1099]);
    expect(OKE_ERROR_RANGES.store).toEqual([1100, 1199]);
    expect(OKE_ERROR_RANGES.signal).toEqual([1200, 1299]);
    expect(OKE_ERROR_RANGES.clock).toEqual([1300, 1399]);
    expect(OKE_ERROR_RANGES.gate).toEqual([1400, 1499]);
    expect(OKE_ERROR_RANGES.vault).toEqual([1500, 1599]);
    expect(OKE_ERROR_RANGES.channel).toEqual([1600, 1699]);
    expect(OKE_ERROR_RANGES.ai).toEqual([1700, 1799]);
    expect(OKE_ERROR_RANGES.mcp_tenancy).toEqual([1800, 1899]);
    expect(OKE_ERROR_RANGES.compiler).toEqual([1900, 1999]);
  });

  test("lazy discovery finds live-resume, channel, and tenant modules without a hand list", async () => {
    const { files, defs } = await discoverLazyErrorDefs(KERNEL_DIR);
    expect(files).toContain("errors-live-resume.ts");
    expect(files).toContain("errors-channel.ts");
    expect(files).toContain("errors-tenant.ts");
    const codes = defs.map((d) => d.code);
    expect(codes).toContain(1210);
    expect(codes).toContain(1605);
    expect(codes).toContain(1810);
    expect(codes).toContain(1820);
    expect(codes).toContain(1830);
  });

  test("adversarial: out-of-range synthetic def fails range check", () => {
    const bad: OkeErrorDefinition = {
      code: 1999,
      domain: "kernel",
      cause: "probe",
      fix: "probe",
    };
    expect(findOutOfRangeDefs([bad])).toEqual([bad]);
    expect(() => assertCodesInDomainRanges([bad])).toThrow(/outside domain range/);
  });

  test("adversarial: duplicate synthetic def fails uniqueness check", () => {
    const clone: OkeErrorDefinition = {
      ...OKE_ERRORS.UNDECLARED_READ,
      cause: "dup",
      fix: "dup",
    };
    expect(findDuplicateCodes([OKE_ERRORS.UNDECLARED_READ, clone])).toEqual([1001]);
    expect(() => assertUniqueCodes([OKE_ERRORS.UNDECLARED_READ, clone])).toThrow(/Duplicate/);
  });

  test("adversarial: filesystem probe is discovered and fails range/uniqueness", async () => {
    await writeFile(
      PROBE_PATH,
      [
        'import type { OkeErrorDefinition } from "./errors.ts";',
        "export const PROBE_OUT_OF_RANGE: OkeErrorDefinition = {",
        "  code: 1999,",
        '  domain: "kernel",',
        '  cause: "adversarial probe",',
        '  fix: "delete this file",',
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    try {
      const { files, defs } = await discoverLazyErrorDefs(KERNEL_DIR);
      expect(files).toContain(PROBE_FILE);
      const probe = defs.find((d) => d.code === 1999);
      expect(probe).toBeDefined();
      const all = [...Object.values(OKE_ERRORS), ...defs];
      expect(findOutOfRangeDefs(all).some((d) => d.code === 1999)).toBe(true);
      expect(() => assertCodesInDomainRanges(all)).toThrow(/OKE1999/);
    } finally {
      await unlink(PROBE_PATH).catch(() => undefined);
    }
  });

  afterAll(async () => {
    await unlink(PROBE_PATH).catch(() => undefined);
  });

  test("every entry has non-empty cause and fix templates", async () => {
    const { defs: lazy } = await discoverLazyErrorDefs(KERNEL_DIR);
    for (const [key, def] of Object.entries(OKE_ERRORS)) {
      expect(def.cause.trim().length, `${key}.cause`).toBeGreaterThan(0);
      expect(def.fix.trim().length, `${key}.fix`).toBeGreaterThan(0);
      expect(Number.isInteger(def.code), `${key}.code`).toBe(true);
      expect(def.code, `${key}.code`).toBeGreaterThan(0);
      expect(def.domain, `${key}.domain`).toBeTruthy();
    }
    for (const def of lazy) {
      expect(def.cause.trim().length, `${def.code}.cause`).toBeGreaterThan(0);
      expect(def.fix.trim().length, `${def.code}.fix`).toBeGreaterThan(0);
    }
  });

  test("OkeError docsUrl matches docs origin /e/{code}", async () => {
    const { defs: lazy } = await discoverLazyErrorDefs(KERNEL_DIR);
    for (const def of [...Object.values(OKE_ERRORS), ...lazy] as OkeErrorDefinition[]) {
      const err = new OkeError(def);
      expect(err.docsUrl).toBe(`https://oke.omqkhafi.dev/e/${def.code}`);
      expect(err.message).toContain(err.docsUrl);
      expect(err.message).toContain(`OKE${def.code}`);
      expect(err.message).toContain("→");
    }
  });

  test("lookupOkeError finds the lazy LIVE_RESUME_GAP entry", () => {
    expect(lookupOkeError(1210)).toEqual(LIVE_RESUME_GAP);
  });

  test("lookupOkeError finds the lazy CHANNEL_SCHEMA entry", () => {
    expect(lookupOkeError(1605)).toEqual(CHANNEL_SCHEMA);
  });

  test("lookupOkeError finds lazy tenant entries", () => {
    expect(lookupOkeError(1810)).toEqual(TENANT_REQUIRED);
    expect(lookupOkeError(1820)).toEqual(TENANT_NOT_MEMBER);
    expect(lookupOkeError(1830)).toEqual(TENANT_UNKNOWN_SCOPE);
  });

  test("lazy discovery finds FLOW_NAME_DUPLICATE at 1070", async () => {
    const { files, defs } = await discoverLazyErrorDefs(KERNEL_DIR);
    expect(files).toContain("errors-flow-name.ts");
    expect(defs.some((d) => d.code === 1070)).toBe(true);
    expect(FLOW_NAME_DUPLICATE.code).toBe(1070);
  });

  test("NO_EFFECTS_DECLARED owns 1020 after renumber (was UNDECLARED_EMBED)", () => {
    expect(OKE_ERRORS.NO_EFFECTS_DECLARED.code).toBe(1020);
    expect(OKE_ERRORS.UNDECLARED_EMBED.code).toBe(1009);
  });
});
