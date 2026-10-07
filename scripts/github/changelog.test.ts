import { describe, expect, test } from "bun:test";

import { changelogSection, milestoneTitlesForVersion } from "./changelog.ts";

const sample = [
  "## Unreleased",
  "",
  "## v0.24.0 — 2026-10-31",
  "",
  "### ✨ Added",
  "",
  "- Pluggable deciders.",
  "",
  "## v0.23.2 — 2026-10-07",
  "",
  "- Previous.",
  "",
].join("\n");

describe("changelogSection", () => {
  test("returns one version section", () => {
    expect(changelogSection(sample, "0.24.0")).toBe(
      ["## v0.24.0 — 2026-10-31", "", "### ✨ Added", "", "- Pluggable deciders."].join("\n"),
    );
  });

  test("returns null when the version is missing", () => {
    expect(changelogSection(sample, "0.24.1")).toBeNull();
  });
});

describe("milestoneTitlesForVersion", () => {
  test("tries the exact version, then the release train", () => {
    expect(milestoneTitlesForVersion("0.24.0")).toEqual(["0.24.0", "0.24"]);
    expect(milestoneTitlesForVersion("0.25")).toEqual(["0.25"]);
  });
});
