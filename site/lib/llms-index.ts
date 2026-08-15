/**
 * Spec-compliant `/llms.txt` and `/llms.json` builders (llmstxt.org).
 *
 * Curated H2 sections first; every remaining handbook page lands under
 * `## Optional` last so a tight context window can skip the long tail.
 */

import { DOCS_ORIGIN } from "./agent-onboard";
import { docsContentRoute } from "./shared";
import { source } from "./source";

/** One handbook page as the index builders see it. */
export interface LlmsPageRef {
  readonly slugs: readonly string[];
  readonly url: string;
  readonly title: string;
  readonly description: string;
}

/** Curated H2 → docs slugs (empty string is `/docs`). `## Optional` is last. */
export const LLMS_PRIMARY_SECTIONS: readonly {
  readonly heading: string;
  readonly slugs: readonly string[];
}[] = [
  {
    heading: "Start here",
    slugs: [
      "get-started/introduction",
      "get-started/installation",
      "get-started/basic-usage",
      "get-started/why",
    ],
  },
  {
    heading: "Elements",
    slugs: [
      "elements/flow",
      "elements/signal",
      "elements/store",
      "elements/clock",
      "elements/gate",
      "elements/vault",
      "elements/channel",
      "elements/ai",
    ],
  },
  {
    heading: "For agents",
    slugs: ["ai/mcp", "ai/skills", "ai/llms-txt"],
  },
  {
    heading: "Reference",
    slugs: [
      "reference/configuration",
      "reference/fx",
      "reference/client",
      "reference/cli",
      "reference/errors",
      "reference/security",
      "reference/environment-variables",
    ],
  },
];

/** Extra machine/site URLs listed in the index (not handbook pages). */
export const LLMS_EXTRA_LINKS: readonly {
  readonly title: string;
  readonly path: string;
  readonly note: string;
  readonly section: "For agents" | "Optional";
}[] = [
  {
    title: "AGENTS.md",
    path: "/llms/agents",
    note: "Agent contract — eight elements, ten exports, the fx rule.",
    section: "For agents",
  },
  {
    title: "llms.json",
    path: "/llms.json",
    note: "Same catalogue as JSON — slug, HTML URL, markdown URL.",
    section: "For agents",
  },
  {
    title: "Changelog",
    path: "/changelog",
    note: "Release notes for okengine.",
    section: "Optional",
  },
];

/**
 * Absolute URL on the published docs origin.
 *
 * @param path - Site-relative path beginning with `/`
 * @param origin - Override for tests
 */
export function absoluteDocsUrl(path: string, origin: string = DOCS_ORIGIN): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${origin.replace(/\/$/, "")}${normalized}`;
}

/**
 * Per-page markdown path (`/llms.mdx/docs/…`, no `content.md` suffix).
 *
 * @param slugs - Docs slug segments
 */
export function markdownPathForSlugs(slugs: readonly string[]): string {
  if (slugs.length === 0) return docsContentRoute;
  return `${docsContentRoute}/${slugs.join("/")}`;
}

/**
 * Collect handbook pages from the live Fumadocs source.
 */
export function listLlmsPages(): LlmsPageRef[] {
  return source.getPages().map((page) => ({
    slugs: page.slugs,
    url: page.url,
    title: page.data.title,
    description: typeof page.data.description === "string" ? page.data.description : "",
  }));
}

/**
 * Build the llmstxt.org index body.
 *
 * @param origin - Absolute origin for links
 * @param pages - Handbook pages; defaults to the live source
 */
export function buildLlmsTxt(
  origin: string = DOCS_ORIGIN,
  pages: readonly LlmsPageRef[] = listLlmsPages(),
): string {
  const bySlug = new Map(pages.map((page) => [page.slugs.join("/"), page]));
  const used = new Set<string>();
  const lines: string[] = [
    "# okengine",
    "",
    "> One law. Eight elements. Ten exports. The batteries-included TypeScript backend for the Bun era. This file is the machine-readable map of the handbook.",
    "",
    "Fetch `/llms.mdx/docs/⟨slug⟩` for one page as markdown, `/llms-full.txt` for everything, `/llms/agents` for the agent contract.",
    "",
  ];

  for (const section of LLMS_PRIMARY_SECTIONS) {
    lines.push(`## ${section.heading}`, "");
    if (section.heading === "For agents") {
      for (const extra of LLMS_EXTRA_LINKS.filter((e) => e.section === "For agents")) {
        lines.push(linkLine(extra.title, absoluteDocsUrl(extra.path, origin), extra.note));
      }
    }
    for (const slug of section.slugs) {
      const page = bySlug.get(slug);
      if (!page) continue;
      used.add(slug);
      lines.push(pageLink(page, origin));
    }
    lines.push("");
  }

  lines.push("## Optional", "");
  for (const extra of LLMS_EXTRA_LINKS.filter((e) => e.section === "Optional")) {
    lines.push(linkLine(extra.title, absoluteDocsUrl(extra.path, origin), extra.note));
  }
  const rest = pages
    .filter((page) => !used.has(page.slugs.join("/")))
    .slice()
    .sort((a, b) => a.url.localeCompare(b.url));
  for (const page of rest) {
    lines.push(pageLink(page, origin));
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Structured catalogue for `/llms.json`.
 *
 * @param origin - Absolute origin for links
 * @param pages - Handbook pages; defaults to the live source
 */
export function buildLlmsCatalog(
  origin: string = DOCS_ORIGIN,
  pages: readonly LlmsPageRef[] = listLlmsPages(),
): {
  readonly name: "okengine";
  readonly description: string;
  readonly origin: string;
  readonly index: string;
  readonly full: string;
  readonly agents: string;
  readonly pages: readonly {
    readonly slug: string;
    readonly title: string;
    readonly description: string;
    readonly html: string;
    readonly markdown: string;
  }[];
} {
  const sorted = pages.slice().sort((a, b) => a.url.localeCompare(b.url));
  return {
    name: "okengine",
    description:
      "One law. Eight elements. Ten exports. The batteries-included TypeScript backend for the Bun era.",
    origin,
    index: absoluteDocsUrl("/llms.txt", origin),
    full: absoluteDocsUrl("/llms-full.txt", origin),
    agents: absoluteDocsUrl("/llms/agents", origin),
    pages: sorted.map((page) => ({
      slug: page.slugs.join("/"),
      title: page.title,
      description: page.description,
      html: absoluteDocsUrl(page.url, origin),
      markdown: absoluteDocsUrl(markdownPathForSlugs(page.slugs), origin),
    })),
  };
}

/**
 * @param page - Handbook page
 * @param origin - Absolute origin
 */
function pageLink(page: LlmsPageRef, origin: string): string {
  return linkLine(
    page.title,
    absoluteDocsUrl(markdownPathForSlugs(page.slugs), origin),
    clipNote(page.description),
  );
}

/**
 * @param title - Link text
 * @param href - Absolute URL
 * @param note - Description after the colon
 */
function linkLine(title: string, href: string, note: string): string {
  return note.length > 0 ? `- [${title}](${href}): ${note}` : `- [${title}](${href})`;
}

/**
 * Keep link notes inside the ~120-character llmstxt.org guidance.
 *
 * @param text - Page description
 */
function clipNote(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= 120) return t;
  return `${t.slice(0, 117).trimEnd()}...`;
}
