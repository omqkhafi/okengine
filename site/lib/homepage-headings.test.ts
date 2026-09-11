/**
 * Gate: homepage heading outline is H1 in the hero only — no band sections.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const siteRoot = join(import.meta.dir, "..");

function source(rel: string): string {
  return readFileSync(join(siteRoot, rel), "utf8");
}

describe("homepage heading outline", () => {
  test("one H1 in the hero; page is hero-only (no Band sections)", () => {
    const hero = source("components/landing/hero-title.tsx");
    expect(hero).toMatch(/<motion\.h1\b/);
    expect(hero).not.toMatch(/<h2\b/);
    expect(hero).not.toMatch(/<h3\b/);

    const page = source("app/(home)/page.tsx");
    expect(page).toContain("<HeroTitle />");
    expect(page).toContain("<HeroLattice />");
    expect(page).not.toMatch(/<Band\b/);
    expect(page).not.toMatch(/ClaimStrip/);
    expect(page).not.toMatch(/<h2\b/);
    expect(page).not.toMatch(/<h3\b/);
    expect(page).not.toMatch(/<h4\b/);
  });
});
