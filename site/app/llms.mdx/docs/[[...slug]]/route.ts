import { markdownResponse } from "@/lib/markdown-response";
import { markdownNotFoundResponse } from "@/lib/not-found-markdown";
import {
  getPageMarkdownUrl,
  getPageSourceMarkdown,
  resolveMarkdownPage,
  source,
} from "@/lib/source";

export const revalidate = false;

/**
 * Serve byte-identical source markdown (YAML frontmatter stripped).
 * Canonical: `/llms.mdx/docs/⟨slug⟩.md`. Also accepts `/content.md`
 * and the extensionless slug. Rewrite target for `Accept: text/markdown`
 * on `/docs/⟨slug⟩`, so the response carries `Vary: Accept`.
 */
export async function GET(_req: Request, { params }: RouteContext<"/llms.mdx/docs/[[...slug]]">) {
  const { slug } = await params;
  const page = resolveMarkdownPage(slug);
  if (!page) return markdownNotFoundResponse();

  return markdownResponse(await getPageSourceMarkdown(page));
}

export function generateStaticParams() {
  return source.getPages().flatMap((page) => {
    const canonical = { slug: getPageMarkdownUrl(page).segments };
    const legacy =
      page.slugs.length > 0 ? { slug: [...page.slugs, "content.md"] } : { slug: ["content.md"] };
    return [canonical, legacy];
  });
}
