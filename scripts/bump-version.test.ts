/**
 * bump-version — Unreleased → versioned section promotion.
 */

import { describe, expect, test } from "bun:test";
import { promoteUnreleasedSection } from "./bump-version.ts";

describe("promoteUnreleasedSection", () => {
  test("renames Unreleased into vX.Y.Z and leaves a fresh empty Unreleased", () => {
    const raw = [
      "# Changelog",
      "",
      "## Unreleased",
      "",
      "### Added",
      "",
      "- New thing.",
      "",
      "### Fixed",
      "",
      "- A bug.",
      "",
      "## v1.0.0 — 2026-01-01",
      "",
      "### Added",
      "",
      "- Old thing.",
      "",
    ].join("\n");

    const out = promoteUnreleasedSection(raw, "1.1.0", "2026-07-31");

    expect(out).toContain("## Unreleased\n\n## v1.1.0 — 2026-07-31");
    expect(out).toContain("- New thing.");
    expect(out).toContain("- A bug.");
    expect(out).toContain("## v1.0.0 — 2026-01-01");
    // Unreleased body must not remain under the staging heading.
    expect(out.indexOf("## Unreleased")).toBeLessThan(out.indexOf("## v1.1.0"));
    expect(out.indexOf("- New thing.")).toBeGreaterThan(out.indexOf("## v1.1.0"));
  });

  test("fails when Unreleased is missing", () => {
    expect(() =>
      promoteUnreleasedSection(
        "## v1.0.0 — 2026-01-01\n\n### Added\n\n- x.\n",
        "1.0.1",
        "2026-01-02",
      ),
    ).toThrow(/no ## Unreleased/);
  });

  test("fails when Unreleased has no bullets", () => {
    expect(() =>
      promoteUnreleasedSection(
        "# Changelog\n\n## Unreleased\n\n## v1.0.0 — 2026-01-01\n\n### Added\n\n- x.\n",
        "1.0.1",
        "2026-01-02",
      ),
    ).toThrow(/no bullets/);
  });
});
