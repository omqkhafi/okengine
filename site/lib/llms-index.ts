/**
 * Spec-compliant `/llms.txt` and `/llms.json` builders (llmstxt.org).
 *
 * Curated H2 sections first; every remaining handbook page lands under
 * `## Optional` last so a tight context window can skip the long tail.
 */

import { DOCS_ORIGIN } from "./agent-onboard";
import { createOkeNpmUrl, docsContentRoute, githubRepoUrl, npmPackageUrl } from "./shared";
import { SITE_DESCRIPTION, SITE_NAME } from "./site-identity";
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
    heading: "Understand",
    slugs: [
      "understand/the-problem",
      "understand/the-model",
      "understand/the-vocabulary",
      "understand/the-anatomy",
    ],
  },
  {
    heading: "Elements",
    slugs: [
      "elements/flow",
      "elements/flow/http",
      "elements/flow/routing",
      "elements/flow/consumers",
      "elements/flow/workflows",
      "elements/signal",
      "elements/signal/once",
      "elements/signal/broadcast",
      "elements/signal/live",
      "elements/store",
      "elements/store/sql",
      "elements/store/kv",
      "elements/store/files",
      "elements/store/search",
      "elements/clock",
      "elements/clock/schedules",
      "elements/clock/intervals",
      "elements/clock/sleep",
      "elements/gate",
      "elements/gate/auth",
      "elements/gate/tenancy",
      "elements/gate/authorization",
      "elements/gate/rate-limits",
      "elements/vault",
      "elements/vault/secrets",
      "elements/vault/config",
      "elements/vault/rotation",
      "elements/channel",
      "elements/channel/email",
      "elements/channel/sms",
      "elements/channel/push",
      "elements/channel/receipts",
      "elements/ai",
      "elements/ai/models",
      "elements/ai/prompts",
      "elements/ai/agents",
      "elements/ai/mcp",
    ],
  },
  {
    heading: "For agents",
    slugs: ["ai/mcp", "ai/skills", "ai/llms-txt"],
  },
  {
    heading: "Reference",
    slugs: [
      "reference/architecture",
      "reference/manifest",
      "reference/configuration",
      "reference/fx",
      "reference/client",
      "reference/errors",
      "reference/environment-variables",
      "reference/okid",
      "reference/i18n",
      "reference/plugins",
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
    note: "Agent contract — one law, eight elements, one contract, the fx rule.",
    section: "For agents",
  },
  {
    title: "llms.json",
    path: "/llms.json",
    note: "Same catalogue as JSON — slug, HTML URL, markdown URL.",
    section: "For agents",
  },
  {
    title: "okengine on npm",
    path: npmPackageUrl,
    note: "Published package — the `oke` CLI binary ships on this package.",
    section: "For agents",
  },
  {
    title: "create-oke on npm",
    path: createOkeNpmUrl,
    note: "Scaffolding CLI — `bunx create-oke@latest`.",
    section: "For agents",
  },
  {
    title: "GitHub",
    path: githubRepoUrl,
    note: "Source repository.",
    section: "For agents",
  },
  {
    title: "Changelog",
    path: "/changelog",
    note: "Release notes for okengine, split by minor version.",
    section: "Optional",
  },
];

/**
 * Absolute URL on the published docs origin, or pass-through for `https://` extras.
 *
 * @param path - Site-relative path beginning with `/`, or an absolute http(s) URL
 * @param origin - Override for tests
 */
export function absoluteDocsUrl(path: string, origin: string = DOCS_ORIGIN): string {
  if (path.startsWith("https://") || path.startsWith("http://")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${origin.replace(/\/$/, "")}${normalized}`;
}

/**
 * Per-page markdown path (`/llms.mdx/docs/⟨slug⟩.md`).
 *
 * @param slugs - Docs slug segments
 */
export function markdownPathForSlugs(slugs: readonly string[]): string {
  if (slugs.length === 0) return `${docsContentRoute}/index.md`;
  const last = slugs.at(-1);
  if (last === undefined) return `${docsContentRoute}/index.md`;
  const head = slugs.slice(0, -1);
  return head.length > 0
    ? `${docsContentRoute}/${head.join("/")}/${last}.md`
    : `${docsContentRoute}/${last}.md`;
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
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_DESCRIPTION} This file is the machine-readable map of the handbook.`,
    "",
    "Fetch `/llms.mdx/docs/⟨slug⟩.md` for one page as markdown, `/llms-full.txt` for everything, `/llms/agents` for the agent contract.",
    "",
    "## When to use this",
    "",
    "Building or changing an okengine app.",
    "",
  ];
  const whenToUse = [
    pageLinkFromSlug(bySlug, "understand/the-problem", origin),
    pageLinkFromSlug(bySlug, "understand/the-model", origin),
    linkLine("AGENTS.md", absoluteDocsUrl("/llms/agents", origin), extraNote("AGENTS.md")),
    pageLinkFromSlug(bySlug, "ai/mcp", origin),
    pageLinkFromSlug(bySlug, "reference/cli", origin),
    pageLinkFromSlug(bySlug, "reference/errors", origin),
    linkLine("okengine on npm", npmPackageUrl, extraNote("okengine on npm")),
    linkLine("create-oke on npm", createOkeNpmUrl, extraNote("create-oke on npm")),
    linkLine("GitHub", githubRepoUrl, extraNote("GitHub")),
  ].filter((line) => line.length > 0);
  lines.push(...whenToUse, "");

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
  readonly name: typeof SITE_NAME;
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
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
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
 * @param bySlug - Pages keyed by joined slug
 * @param slug - Handbook slug such as `understand/the-problem`
 * @param origin - Absolute origin
 */
function pageLinkFromSlug(bySlug: Map<string, LlmsPageRef>, slug: string, origin: string): string {
  const page = bySlug.get(slug);
  return page === undefined ? "" : pageLink(page, origin);
}

/**
 * @param title - Extra link title in `LLMS_EXTRA_LINKS`
 */
function extraNote(title: string): string {
  return LLMS_EXTRA_LINKS.find((extra) => extra.title === title)?.note ?? "";
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
