/**
 * Gate: crawler entry points exist and stay allow-all + complete.
 */

import { describe, expect, test } from "bun:test";
import robots from "../app/robots.ts";
import sitemap from "../app/sitemap.ts";
import { DOCS_ORIGIN } from "./agent-onboard";
import { source } from "./source";

describe("robots.txt", () => {
  test("allows every named AI crawler and points at the sitemap", () => {
    const file = robots();
    expect(file.host).toBe(DOCS_ORIGIN);
    expect(file.sitemap).toBe(`${DOCS_ORIGIN}/sitemap.xml`);
    const agents = (Array.isArray(file.rules) ? file.rules : [file.rules]).map(
      (rule) => rule.userAgent,
    );
    expect(agents).toContain("*");
    expect(agents).toContain("GPTBot");
    expect(agents).toContain("ClaudeBot");
    expect(agents).toContain("PerplexityBot");
  });
});

describe("sitemap.xml", () => {
  test("lists the homepage, machine endpoints, and every docs page", () => {
    const entries = sitemap();
    const urls = new Set(entries.map((e) => e.url));
    expect(urls.has(DOCS_ORIGIN)).toBe(true);
    expect(urls.has(`${DOCS_ORIGIN}/llms.txt`)).toBe(true);
    expect(urls.has(`${DOCS_ORIGIN}/llms.json`)).toBe(true);
    expect(urls.has(`${DOCS_ORIGIN}/llms/agents`)).toBe(true);
    expect(urls.has(`${DOCS_ORIGIN}/changelog`)).toBe(true);
    for (const page of source.getPages()) {
      expect(urls.has(`${DOCS_ORIGIN}${page.url}`)).toBe(true);
    }
  });
});
