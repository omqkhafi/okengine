/**
 * Error-code registry gate — unique codes, cause/fix/docsUrl shape (§21).
 *
 * Docs pages (docs/e/{code}.md) are deferred to a dedicated docs prompt;
 * this gate enforces registry invariants only.
 */

import { describe, expect, test } from "bun:test";
import { OKE_ERRORS, OkeError, lookupOkeError, type OkeErrorDefinition } from "./errors.ts";
import { LIVE_RESUME_GAP } from "./errors-live-resume.ts";

describe("OKE error-code registry", () => {
  test("every code is unique", () => {
    const codes = [...Object.values(OKE_ERRORS).map((d) => d.code), LIVE_RESUME_GAP.code];
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("every entry has non-empty cause and fix templates", () => {
    for (const [key, def] of Object.entries(OKE_ERRORS)) {
      expect(def.cause.trim().length, `${key}.cause`).toBeGreaterThan(0);
      expect(def.fix.trim().length, `${key}.fix`).toBeGreaterThan(0);
      expect(Number.isInteger(def.code), `${key}.code`).toBe(true);
      expect(def.code, `${key}.code`).toBeGreaterThan(0);
    }
    expect(LIVE_RESUME_GAP.cause.trim().length).toBeGreaterThan(0);
    expect(LIVE_RESUME_GAP.fix.trim().length).toBeGreaterThan(0);
  });

  test("OkeError docsUrl matches docs origin /e/{code}", () => {
    for (const def of [...Object.values(OKE_ERRORS), LIVE_RESUME_GAP] as OkeErrorDefinition[]) {
      const err = new OkeError(def);
      expect(err.docsUrl).toBe(`https://oke.omqkhafi.dev/e/${def.code}`);
      expect(err.message).toContain(err.docsUrl);
      expect(err.message).toContain(`OKE${def.code}`);
      expect(err.message).toContain("→");
    }
  });

  test("lookupOkeError finds the lazy LIVE_RESUME_GAP entry", () => {
    expect(lookupOkeError(1014)).toEqual(LIVE_RESUME_GAP);
  });
});
