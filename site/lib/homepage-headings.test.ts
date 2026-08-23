/**
 * Gate: homepage heading outline is H1 → H2 → H3 with no skipped levels
 * and no extra visual copy — tags only, same classes as before.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const siteRoot = join(import.meta.dir, "..");

function source(rel: string): string {
  return readFileSync(join(siteRoot, rel), "utf8");
}

describe("homepage heading outline", () => {
  test("one H1 in the hero, BandHeading is H2, untitled bands use label H2", () => {
    const hero = source("components/landing/hero-title.tsx");
    expect(hero).toMatch(/<motion\.h1\b/);
    expect(hero).not.toMatch(/<h2\b/);
    expect(hero).not.toMatch(/<h3\b/);

    const band = source("components/landing/band.tsx");
    expect(band).toContain('type BandLabelTag = "span" | "h2"');
    expect(band).toContain(
      '<h2 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">',
    );

    const page = source("app/(home)/page.tsx");
    expect(page).toContain('<Band label="readme" labelAs="h2">');
    expect(page).toContain('<Band label="stack" labelAs="h2">');
    expect(page).toContain("Built with");
    expect(page).toContain("Works with");
    expect(page).toMatch(
      /<h3 className="font-mono text-\[11px\] tracking-\[0\.16em\] text-fd-muted-foreground uppercase">/,
    );
    expect(page).toContain('<h3 className="text-sm font-medium">{item.title}</h3>');
    expect(page).toContain(
      '<h2 className="max-w-[22ch] text-2xl font-semibold tracking-tight text-balance sm:text-3xl">',
    );
    expect(page).not.toMatch(/<h4\b/);
  });

  test("H2 sections nest real H3 subsections (elements, exports, surfaces, manifest)", () => {
    const features = source("components/docs/features.tsx");
    expect(features).toContain('<h3 className="mt-3 text-base font-semibold text-fd-foreground">');
    expect(features).toContain("{feature.name}");

    const vocabulary = source("components/landing/vocabulary.tsx");
    expect(vocabulary).toContain(
      '<h3 className="min-w-0 truncate font-mono text-sm font-medium text-fd-foreground">',
    );
    expect(vocabulary).toContain("{entry.name}");

    const surfaces = source("components/landing/surfaces.tsx");
    expect(surfaces).toContain(
      '<h3 className="font-mono text-[11px] tracking-[0.14em] text-fd-muted-foreground uppercase">',
    );
    expect(surfaces).toContain("{surface.surface}");

    const manifest = source("components/landing/manifest-pipeline.tsx");
    expect(manifest).toContain('<h3 className="text-sm font-medium">You write TypeScript</h3>');
    expect(manifest).toContain('<h3 className="text-sm font-medium">One artifact</h3>');
    expect(manifest).toContain('<h3 className="text-sm font-medium">Every surface is derived</h3>');
    expect(manifest).toContain("01 · inputs via fx");
    expect(manifest).toContain("02 · artifact keys");
    expect(manifest).toContain("03 · derived ·");
    expect(manifest).not.toMatch(/<h4\b/);
  });
});
