import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/plugins/lucide-icons";
import { expandTeachingFigures } from "./llms-figures";
import { readDocsSourceBody } from "./markdown-source";
import { docsContentRoute, docsImageRoute, docsRoute } from "./shared";
import { sidebarIconsPlugin } from "./sidebar-icons";

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin(), sidebarIconsPlugin()],
});

/**
 * Build the OG image URL for a docs page.
 *
 * @param page - Loaded docs page
 */
export function getPageImageUrl(page: (typeof source)["$inferPage"]) {
  const segments = [...page.slugs, "image.png"];

  return {
    segments,
    url: "/" + [page.locale, ...docsImageRoute.split("/"), ...segments].filter(Boolean).join("/"),
  };
}

/**
 * Build the per-page markdown URL used by Copy Markdown / Open-in prompts.
 *
 * @param page - Loaded docs page
 */
export function getPageMarkdownUrl(page: (typeof source)["$inferPage"]) {
  // Always end in `.md`. Extensionless `/llms.mdx/docs/ai` is a file next
  // to `/llms.mdx/docs/ai/…` — static export cannot copy both.
  const last = page.slugs.at(-1);
  const segments = last !== undefined ? [...page.slugs.slice(0, -1), `${last}.md`] : ["index.md"];

  return {
    segments,
    url: "/" + [page.locale, ...docsContentRoute.split("/"), ...segments].filter(Boolean).join("/"),
  };
}

/**
 * Resolve a docs page from `/llms.mdx/docs/[[...slug]]`.
 * Accepts the canonical slug, a trailing `content.md`, or a `.md` suffix
 * on the last segment.
 *
 * @param slug - Catch-all segments from the markdown route
 */
export function resolveMarkdownPage(
  slug: readonly string[] | undefined,
): (typeof source)["$inferPage"] | undefined {
  const parts = [...(slug ?? [])];
  const last = parts.at(-1);
  if (last === "content.md") {
    parts.pop();
  } else if (last?.endsWith(".md")) {
    const stem = last.slice(0, -".md".length);
    if (stem === "index" && parts.length === 1) {
      parts.pop();
    } else {
      parts[parts.length - 1] = stem;
    }
  }
  return source.getPage(parts.length > 0 ? [...parts] : undefined);
}

/**
 * Source-identical markdown for Copy / `.md` routes (frontmatter stripped).
 *
 * @param page - Loaded docs page
 */
export async function getPageSourceMarkdown(page: (typeof source)["$inferPage"]): Promise<string> {
  return readDocsSourceBody(page.path);
}

/**
 * Concatenated LLM dump for a page (`llms-full.txt` only).
 *
 * @param page - Loaded docs page
 */
export async function getLLMText(page: (typeof source)["$inferPage"]) {
  const body = expandTeachingFigures(await getPageSourceMarkdown(page));

  return `# ${page.data.title} (${page.url})

${body}`;
}
