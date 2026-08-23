/**
 * Gate: machine-readable surfaces stay spec-compliant and figure-complete.
 */

import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS_ORIGIN } from "./agent-onboard";
import { expandTeachingFigures, TEACHING_FIGURE_FALLBACKS } from "./llms-figures";
import { buildLlmsCatalog, buildLlmsTxt, markdownPathForSlugs } from "./llms-index";
import { DOCS_CONTENT_DIR } from "./markdown-source";
import { getPageMarkdownUrl, resolveMarkdownPage, source } from "./source";

describe("buildLlmsTxt", () => {
  test("matches the llmstxt.org skeleton", () => {
    const body = buildLlmsTxt();
    const lines = body.split("\n");
    expect(lines[0]).toBe("# okengine");
    expect(lines[2]?.startsWith("> ")).toBe(true);
    expect(body).toContain("## Start here");
    expect(body).toContain("## Optional");
    expect(body.lastIndexOf("## Optional")).toBeGreaterThan(body.lastIndexOf("## Reference"));
    expect(body).toContain(`${DOCS_ORIGIN}/llms.mdx/docs/elements/vault.md`);
    expect(body).not.toMatch(/\]\(\/docs\//);
    expect(body).toContain("## When to use this");
    expect(body.indexOf("## When to use this")).toBeLessThan(body.indexOf("## Start here"));
    expect(body).toContain("https://www.npmjs.com/package/okengine");
    expect(body).toContain("https://www.npmjs.com/package/create-oke");
    expect(body).toContain("https://github.com/omqkhafi/okengine");
  });

  test("every link is an absolute https URL", () => {
    const re = /\]\(([^)]+)\)/g;
    const body = buildLlmsTxt();
    let match: RegExpExecArray | null;
    while ((match = re.exec(body)) !== null) {
      expect(match[1]?.startsWith("https://")).toBe(true);
    }
  });
});

describe("buildLlmsCatalog", () => {
  test("lists every source page with html and markdown twins", () => {
    const catalog = buildLlmsCatalog();
    expect(catalog.name).toBe("okengine");
    expect(catalog.pages.length).toBe(source.getPages().length);
    const vault = catalog.pages.find((p) => p.slug === "elements/vault");
    expect(vault?.html).toBe(`${DOCS_ORIGIN}/docs/elements/vault`);
    expect(vault?.markdown).toBe(`${DOCS_ORIGIN}/llms.mdx/docs/elements/vault.md`);
  });
});

describe("resolveMarkdownPage", () => {
  test("accepts canonical slug, content.md, and .md suffix", () => {
    const canonical = resolveMarkdownPage(["elements", "vault"]);
    const legacy = resolveMarkdownPage(["elements", "vault", "content.md"]);
    const dotted = resolveMarkdownPage(["elements", "vault.md"]);
    expect(canonical?.url).toBe("/docs/elements/vault");
    expect(legacy?.url).toBe("/docs/elements/vault");
    expect(dotted?.url).toBe("/docs/elements/vault");
  });

  test("resolves the docs index from empty, content.md, and index.md", () => {
    expect(resolveMarkdownPage(undefined)?.url).toBe("/docs");
    expect(resolveMarkdownPage(["content.md"])?.url).toBe("/docs");
    expect(resolveMarkdownPage(["index.md"])?.url).toBe("/docs");
  });
});

describe("llms/agents contract route", () => {
  test("points at a readable repo-root AGENTS.md", async () => {
    const routePath = join(import.meta.dir, "..", "app", "llms", "agents", "route.ts");
    const route = await Bun.file(routePath).text();
    expect(route).toContain("AGENTS.md");
    const contract = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "AGENTS.md");
    expect(await Bun.file(contract).exists()).toBe(true);
    const body = await Bun.file(contract).text();
    expect(body.length).toBeGreaterThan(100);
  });
});

describe("markdownPathForSlugs", () => {
  test("omits the content.md suffix", () => {
    expect(markdownPathForSlugs([])).toBe("/llms.mdx/docs/index.md");
    expect(markdownPathForSlugs(["elements", "vault"])).toBe("/llms.mdx/docs/elements/vault.md");
  });

  test("docs index markdown is index.md so the public URL has no file/dir clash", () => {
    const index = source.getPages().find((page) => page.slugs.length === 0);
    expect(index).toBeDefined();
    expect(getPageMarkdownUrl(index!).url).toBe("/llms.mdx/docs/index.md");
  });
});

describe("expandTeachingFigures", () => {
  test("inlines every mapped void figure and StoreFacetMark", () => {
    const body = ["<FlowTriggers />", '<StoreFacetMark facet="sql" />', "<VaultResolution />"].join(
      "\n",
    );
    const expanded = expandTeachingFigures(body);
    expect(expanded).toContain(TEACHING_FIGURE_FALLBACKS.FlowTriggers);
    expect(expanded).toContain("sql facet —");
    expect(expanded).toContain(TEACHING_FIGURE_FALLBACKS.VaultResolution);
    expect(expanded).not.toContain("<FlowTriggers");
  });

  test("every self-closing teaching figure in content/docs has a fallback", async () => {
    const used = new Set<string>();
    async function walk(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(abs);
          continue;
        }
        if (!entry.name.endsWith(".mdx")) continue;
        const text = await Bun.file(abs).text();
        const re = /<([A-Z][A-Za-z]+)\s*(?:facet="\w+"\s*)?\/>/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(text)) !== null) {
          used.add(match[1]!);
        }
      }
    }
    await walk(DOCS_CONTENT_DIR);

    const skip = new Set([
      "Cards",
      "Card",
      "Callout",
      "Steps",
      "Step",
      "Tabs",
      "Tab",
      "TypeTable",
      "Features",
      "CollapseDiagram",
      "ManifestPipeline",
      "Surfaces",
      "Vocabulary",
      "FlowShape",
      "DevModes",
      "ClientLoop",
      "DriftBoard",
      "CollapseBoard",
      "Accordions",
      "Accordion",
    ]);

    for (const name of used) {
      if (skip.has(name)) continue;
      if (name === "StoreFacetMark") continue;
      expect(TEACHING_FIGURE_FALLBACKS[name], `missing fallback for <${name} />`).toBeDefined();
    }
  });
});
