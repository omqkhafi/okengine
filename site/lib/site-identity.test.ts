/**
 * Gate: homepage SoftwareApplication JSON-LD is parseable and uses real
 * identity fields only (no invented Wikipedia / LinkedIn / paid SKU).
 */

import { describe, expect, test } from "bun:test";
import {
  SITE_APPLICATION_CATEGORY,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_OFFER,
  SITE_SAME_AS,
  SITE_URL,
  softwareApplicationJsonLd,
} from "./site-identity.ts";
import { githubRepoUrl, jsrPackageUrl, npmPackageUrl, xProfileUrl } from "./shared.ts";

describe("SoftwareApplication JSON-LD", () => {
  test("parses and includes url, applicationCategory, and a free Offer", () => {
    const data = softwareApplicationJsonLd();
    const parsed = JSON.parse(JSON.stringify(data)) as typeof data;
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(parsed["@type"]).toBe("SoftwareApplication");
    expect(parsed.name).toBe(SITE_NAME);
    expect(parsed.description).toBe(SITE_DESCRIPTION);
    expect(parsed.url).toBe(SITE_URL);
    expect(parsed.url).toBe("https://oke.omqkhafi.dev");
    expect(parsed.applicationCategory).toBe(SITE_APPLICATION_CATEGORY);
    expect(parsed.applicationCategory).toBe("DeveloperApplication");
    expect(parsed.offers).toEqual(SITE_OFFER);
    expect(parsed.offers).toEqual({
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    });
  });

  test("sameAs lists only live profiles (GitHub, npm, JSR, X) — not Wikipedia/Wikidata/LinkedIn", () => {
    const parsed = JSON.parse(JSON.stringify(softwareApplicationJsonLd())) as ReturnType<
      typeof softwareApplicationJsonLd
    >;
    expect(parsed.sameAs).toEqual([...SITE_SAME_AS]);
    expect(parsed.sameAs).toContain(githubRepoUrl);
    expect(parsed.sameAs).toContain(npmPackageUrl);
    expect(parsed.sameAs).toContain(jsrPackageUrl);
    expect(parsed.sameAs).toContain(xProfileUrl);
    expect(parsed.sameAs.some((url) => url.includes("wikipedia.org"))).toBe(false);
    expect(parsed.sameAs.some((url) => url.includes("wikidata.org"))).toBe(false);
    expect(parsed.sameAs.some((url) => url.includes("linkedin.com"))).toBe(false);
  });
});
