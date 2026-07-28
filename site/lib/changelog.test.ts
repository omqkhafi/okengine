/**
 * Changelog parser + source integrity. The `/changelog` page has no fallback:
 * if `docs/changelog.md` drifts from the format, the build must fail here first.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CHANGELOG_SOURCE, parseChangelog, splitInlineCode } from "./changelog.ts";

const ROOT = join(import.meta.dir, "..", "..");

describe("parseChangelog", () => {
  test("reads tag, date, groups, and bullets", () => {
    const releases = parseChangelog(
      [
        "# Changelog",
        "",
        "## v1.2.3 — 2026-01-02",
        "",
        "### Added",
        "",
        "- One thing.",
        "- Another thing.",
        "",
        "### Fixed",
        "",
        "- A bug.",
        "",
      ].join("\n"),
    );

    expect(releases).toHaveLength(1);
    const release = releases[0]!;
    expect(release.version).toBe("1.2.3");
    expect(release.tag).toBe("v1.2.3");
    expect(release.date).toBe("2026-01-02");
    expect(release.groups.map((g) => g.label)).toEqual(["Added", "Fixed"]);
    expect(release.groups[0]!.items).toEqual(["One thing.", "Another thing."]);
  });

  test("folds wrapped bullet lines into one entry", () => {
    const releases = parseChangelog(
      [
        "## v1.0.0 — 2026-01-01",
        "",
        "### Changed",
        "",
        "- A bullet that wraps",
        "  across two lines.",
        "",
      ].join("\n"),
    );

    expect(releases[0]!.groups[0]!.items).toEqual(["A bullet that wraps across two lines."]);
  });

  test("keeps prose before the first group as the release summary", () => {
    const releases = parseChangelog(
      [
        "## v1.0.0 — 2026-01-01",
        "",
        "First published release.",
        "",
        "### Added",
        "",
        "- Everything.",
        "",
      ].join("\n"),
    );

    expect(releases[0]!.summary).toEqual(["First published release."]);
  });

  test("ignores the file preamble, so header prose is not a release", () => {
    const releases = parseChangelog(
      ["# Changelog", "", "Some intro prose.", "", "- a stray bullet", ""].join("\n"),
    );
    expect(releases).toEqual([]);
  });

  test("rejects a bullet that precedes any group heading", () => {
    expect(() =>
      parseChangelog(["## v1.0.0 — 2026-01-01", "", "- orphan bullet", ""].join("\n")),
    ).toThrow(/bullet outside a group/);
  });
});

describe("splitInlineCode", () => {
  test("splits backtick runs from plain text", () => {
    expect(splitInlineCode("run `oke dev` now")).toEqual([
      { code: false, text: "run " },
      { code: true, text: "oke dev" },
      { code: false, text: " now" },
    ]);
  });

  test("passes plain text through as a single segment", () => {
    expect(splitInlineCode("no code here")).toEqual([{ code: false, text: "no code here" }]);
  });
});

describe("docs/changelog.md", () => {
  test("parses, and the newest release matches the published version", async () => {
    const raw = await Bun.file(join(ROOT, CHANGELOG_SOURCE)).text();
    const releases = parseChangelog(raw);

    expect(releases.length).toBeGreaterThan(0);

    const { version } = (await Bun.file(join(ROOT, "package.json")).json()) as {
      version: string;
    };
    expect(releases[0]!.version).toBe(version);
  });

  test("releases are newest-first and every entry carries content", async () => {
    const raw = await Bun.file(join(ROOT, CHANGELOG_SOURCE)).text();
    const releases = parseChangelog(raw);

    const dates = releases.map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);

    for (const release of releases) {
      const bullets = release.groups.reduce((total, group) => total + group.items.length, 0);
      expect(bullets).toBeGreaterThan(0);
    }
  });
});
