import { describe, expect, test } from "bun:test";
import { formatAccessBlastRadius } from "./blast-radius.ts";
import { ACCESS_BLAST_FIXTURE } from "./fixture.ts";

describe("formatAccessBlastRadius", () => {
  test("surfaces volume, last-used, sources, residual note", () => {
    const lines = formatAccessBlastRadius(ACCESS_BLAST_FIXTURE);
    expect(lines.volume).toContain("42");
    expect(lines.lastUsed).toContain("2023");
    expect(lines.sources).toContain("203.0.113.10");
    expect(lines.residual).toBe(ACCESS_BLAST_FIXTURE.residualAccessNote);
    expect(lines.warn).toBe(true);
  });

  test("empty Runs", () => {
    const lines = formatAccessBlastRadius({
      callVolume: 0,
      lastUsedAt: null,
      sourceAddresses: [],
      accessTtlMs: 60_000,
      residualAccessNote: "Existing access may continue up to 1 minute",
    });
    expect(lines.volume).toContain("No recorded");
    expect(lines.warn).toBe(false);
  });
});
