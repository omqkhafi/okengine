/**
 * Canonical public site identity — the values already published in root
 * metadata. JSON-LD, llms.txt, and the layout description read from here so
 * they cannot drift into invented copy.
 */

import { DOCS_ORIGIN } from "./agent-onboard";
import {
  createOkeNpmUrl,
  githubRepoUrl,
  homepageOgPath,
  jsrPackageUrl,
  npmPackageUrl,
  xProfileUrl,
} from "./shared";
import type { Metadata } from "next";

/** Product name shown in metadata, JSON-LD, and the llms.txt H1. */
export const SITE_NAME = "okengine";

/**
 * Site-wide description. Must stay identical to the layout `metadata.description`
 * that ships on every HTML page.
 */
export const SITE_DESCRIPTION =
  "One law. Eight elements. Ten exports. The batteries-included TypeScript backend for the Bun era.";

/** Canonical public origin (no trailing slash). */
export const SITE_URL = DOCS_ORIGIN;

/**
 * Real public profiles for JSON-LD `sameAs`.
 *
 * Included (verified, currently live):
 * GitHub repo, npm `okengine`, npm `create-oke`, JSR `@omqkhafi/okengine`,
 * X `@omqkhafi`.
 *
 * Skipped — no real profile exists: Wikipedia, Wikidata, LinkedIn.
 */
export const SITE_SAME_AS: readonly string[] = [
  githubRepoUrl,
  npmPackageUrl,
  createOkeNpmUrl,
  jsrPackageUrl,
  xProfileUrl,
];

/**
 * Google-supported `applicationCategory` for a backend framework
 * (Search Central SoftwareApplication list — not a generic guess).
 */
export const SITE_APPLICATION_CATEGORY = "DeveloperApplication" as const;

/**
 * Offer for MIT / self-hosted software: free, no paid SKU.
 * `priceCurrency` is ISO 4217 (USD) as required by schema.org Offer.
 */
export const SITE_OFFER = {
  "@type": "Offer",
  price: "0",
  priceCurrency: "USD",
} as const;

/**
 * SoftwareApplication JSON-LD for the homepage. Identity fields come from site
 * metadata; category/offer reflect the real MIT self-hosted model.
 */
export function softwareApplicationJsonLd(): {
  readonly "@context": "https://schema.org";
  readonly "@type": "SoftwareApplication";
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly applicationCategory: typeof SITE_APPLICATION_CATEGORY;
  readonly offers: typeof SITE_OFFER;
  readonly sameAs: readonly string[];
} {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    applicationCategory: SITE_APPLICATION_CATEGORY,
    offers: SITE_OFFER,
    sameAs: SITE_SAME_AS,
  };
}

/** Homepage Open Graph + canonical — type/image/url from existing identity. */
export const HOMEPAGE_METADATA: Metadata = {
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [{ url: homepageOgPath, width: 1200, height: 630 }],
  },
};
