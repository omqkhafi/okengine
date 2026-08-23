/**
 * Gate: markdown negotiation rewrites handbook URLs and 404s unknown paths.
 */

import { describe, expect, test } from "bun:test";
import { GET as getDocsMarkdown } from "../app/llms.mdx/docs/[[...slug]]/route.ts";
import { GET as getHomeMarkdown } from "../app/llms.mdx/home/route.ts";
import { GET as getReleasesMarkdown } from "../app/llms.mdx/releases/[[...slug]]/route.ts";
import { AGENT_READABILITY_TOKEN_BUDGET, estimateAgentTokens } from "./changelog.ts";
import { homepageMarkdownBody } from "./home-markdown.ts";
import { markdownNegotiation, markdownTwinPath } from "./markdown-negotiate.ts";
import { markdownHeaders } from "./markdown-response.ts";
import { markdownNotFoundBody, markdownNotFoundResponse } from "./not-found-markdown.ts";
import { homepageOgPath } from "./shared.ts";
import {
  HOMEPAGE_METADATA,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_SAME_AS,
  SITE_URL,
  softwareApplicationJsonLd,
} from "./site-identity.ts";

function request(path: string, accept?: string): Request {
  const headers = accept === undefined ? undefined : { Accept: accept };
  return new Request(`https://oke.omqkhafi.dev${path}`, { headers });
}

describe("markdownTwinPath", () => {
  test("maps handbook HTML URLs to markdown twins", () => {
    expect(markdownTwinPath("/")).toBe("/llms.mdx/home");
    expect(markdownTwinPath("/docs")).toBe("/llms.mdx/docs/index.md");
    expect(markdownTwinPath("/docs/elements/vault")).toBe("/llms.mdx/docs/elements/vault.md");
    expect(markdownTwinPath("/changelog")).toBe("/llms.mdx/releases");
    expect(markdownTwinPath("/changelog/0.12")).toBe("/llms.mdx/releases/0.12");
  });
});

describe("markdownNegotiation", () => {
  test("Accept: text/markdown rewrites docs, changelog, and home", () => {
    expect(markdownNegotiation(request("/docs/elements/vault", "text/markdown"))).toEqual({
      kind: "rewrite",
      pathname: "/llms.mdx/docs/elements/vault.md",
    });
    expect(markdownNegotiation(request("/changelog", "text/markdown"))).toEqual({
      kind: "rewrite",
      pathname: "/llms.mdx/releases",
    });
    expect(markdownNegotiation(request("/", "text/markdown"))).toEqual({
      kind: "rewrite",
      pathname: "/llms.mdx/home",
    });
  });

  test("Accept: text/html and */* stay on the HTML page", () => {
    expect(markdownNegotiation(request("/docs/elements/vault", "text/html")).kind).toBe("pass");
    expect(markdownNegotiation(request("/docs/elements/vault", "*/*")).kind).toBe("pass");
    expect(markdownNegotiation(request("/docs/elements/vault")).kind).toBe("pass");
  });

  test("unknown paths 404 as markdown when Accept prefers markdown", () => {
    expect(markdownNegotiation(request("/this-path-does-not-exist", "text/markdown"))).toEqual({
      kind: "not-found",
    });
  });

  test("machine endpoints are not 404'd", () => {
    expect(markdownNegotiation(request("/llms.txt", "text/markdown")).kind).toBe("pass");
    expect(
      markdownNegotiation(request("/llms.mdx/docs/elements/vault.md", "text/markdown")).kind,
    ).toBe("pass");
  });
});

describe("markdown responses carry Vary: Accept", () => {
  test("markdownHeaders includes Content-Type and Vary", () => {
    const headers = new Headers(markdownHeaders());
    expect(headers.get("content-type")).toMatch(/text\/markdown/);
    expect(headers.get("vary")).toMatch(/Accept/i);
  });

  test("negotiated 404 is markdown with the three nav aids", () => {
    const body = markdownNotFoundBody();
    expect(body).toContain("/sitemap.xml");
    expect(body).toContain("/llms.txt");
    expect(body).toContain("/docs");
    const response = markdownNotFoundResponse();
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/text\/markdown/);
    expect(response.headers.get("vary")).toMatch(/Accept/i);
  });

  test("docs, home, and changelog markdown routes stamp Vary: Accept", async () => {
    const docs = await getDocsMarkdown(new Request("https://oke.omqkhafi.dev/x"), {
      params: Promise.resolve({ slug: ["elements", "vault.md"] }),
    });
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type")).toMatch(/text\/markdown/);
    expect(docs.headers.get("vary")).toMatch(/Accept/i);
    expect((await docs.text()).length).toBeGreaterThan(0);

    const missing = await getDocsMarkdown(new Request("https://oke.omqkhafi.dev/x"), {
      params: Promise.resolve({ slug: ["no-such-page.md"] }),
    });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("vary")).toMatch(/Accept/i);
    expect(await missing.text()).toContain("/llms.txt");

    const home = getHomeMarkdown();
    expect(home.status).toBe(200);
    expect(home.headers.get("vary")).toMatch(/Accept/i);

    const index = await getReleasesMarkdown(new Request("https://oke.omqkhafi.dev/x"), {
      params: Promise.resolve({ slug: [] }),
    });
    expect(index.status).toBe(200);
    expect(index.headers.get("vary")).toMatch(/Accept/i);
    const indexBody = await index.text();
    expect(indexBody).toContain("/changelog/");
    expect(estimateAgentTokens(indexBody)).toBeLessThanOrEqual(AGENT_READABILITY_TOKEN_BUDGET);
  });
});

describe("homepage markdown twin", () => {
  test("uses published site identity, not invented positioning copy", () => {
    const body = homepageMarkdownBody();
    expect(body.startsWith(`# ${SITE_NAME}`)).toBe(true);
    expect(body).toContain(SITE_DESCRIPTION);
    expect(body).toContain("/llms.txt");
    expect(body).toContain("/docs");
  });
});

describe("SoftwareApplication JSON-LD", () => {
  test("parses and matches site metadata", () => {
    const data = softwareApplicationJsonLd();
    const parsed = JSON.parse(JSON.stringify(data)) as typeof data;
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(parsed["@type"]).toBe("SoftwareApplication");
    expect(parsed.name).toBe(SITE_NAME);
    expect(parsed.description).toBe(SITE_DESCRIPTION);
    expect(parsed.url).toBe(SITE_URL);
    expect(parsed.sameAs).toEqual([...SITE_SAME_AS]);
    expect(parsed.sameAs.some((url) => url.startsWith("https://github.com/"))).toBe(true);
    expect(parsed.sameAs.some((url) => url.includes("npmjs.com"))).toBe(true);
    expect(Object.keys(parsed).sort()).toEqual(
      ["@context", "@type", "description", "name", "sameAs", "url"].sort(),
    );
  });
});

describe("homepage metadata", () => {
  test("canonical, og:type website, and og:image from site identity", () => {
    expect(HOMEPAGE_METADATA.alternates?.canonical).toBe("/");
    expect(HOMEPAGE_METADATA.openGraph?.type).toBe("website");
    expect(HOMEPAGE_METADATA.openGraph?.url).toBe(SITE_URL);
    const images = HOMEPAGE_METADATA.openGraph?.images;
    expect(Array.isArray(images)).toBe(true);
    expect(images?.[0]).toEqual({ url: homepageOgPath, width: 1200, height: 630 });
  });
});
