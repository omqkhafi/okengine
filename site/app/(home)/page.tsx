/**
 * Homepage shell layout adapted from better-auth/better-auth `docs/app/page.tsx`
 * under the MIT License. Copyright (c) 2024 - present, Bereket Engida.
 * See site/NOTICE. Brand art, Trusted By, Ask AI, and sign-in demos omitted;
 * the hero visual is the okengine isometric element lattice driven by fx.
 */

import { HeroFacts } from "@/components/landing/hero-facts";
import {
  HeroFxCode,
  HeroLattice,
  HeroPrism,
  HeroRail,
  HeroWalkProvider,
} from "@/components/landing/hero-stage";
import { HeroTitle } from "@/components/landing/hero-title";
import { JsonLd } from "@/components/json-ld";
import { loadHeroCodeLines } from "@/lib/hero-code";
import { HOMEPAGE_METADATA, softwareApplicationJsonLd } from "@/lib/site-identity";
import type { Metadata } from "next";

export const metadata: Metadata = HOMEPAGE_METADATA;

/**
 * Marketing homepage — hero only: copy on top, then one stage where the starter
 * create Flow and the eight elements run on the same beat, over a measured rail.
 */
export default async function HomePage() {
  const codeLines = await loadHeroCodeLines();

  return (
    <div id="hero" className="relative text-fd-foreground">
      <JsonLd data={softwareApplicationJsonLd()} />
      {/* Clipped: the lattice's decorative grid bleeds past its column padding. */}
      <section className="relative flex min-h-[calc(100svh-2.75rem)] flex-col overflow-x-clip border-b border-fd-border">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-grid-black/[0.02] [mask-image:radial-gradient(70%_55%_at_50%_28%,#000,transparent)] dark:bg-grid-white/[0.02]"
        />
        <HeroWalkProvider>
          <HeroPrism />
          <div className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center px-5 py-12 text-center sm:px-8">
            <HeroTitle />
            {/* One stage: the walk, the elements, and the measured rail in a single frame. */}
            <div className="mt-11 w-full overflow-hidden rounded-xl border border-fd-border bg-fd-card/80 text-start shadow-sm backdrop-blur-sm">
              <div className="grid lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
                {/* Below lg the mono walk truncates past reading — the lattice carries it. */}
                <div className="hidden min-h-[26rem] lg:flex">
                  <HeroFxCode lines={codeLines} />
                </div>
                <div className="border-fd-border lg:border-s">
                  <HeroLattice />
                </div>
              </div>
              <HeroRail facts={<HeroFacts />} />
            </div>
          </div>
        </HeroWalkProvider>
      </section>
    </div>
  );
}
