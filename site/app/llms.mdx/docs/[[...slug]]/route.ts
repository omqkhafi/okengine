import { getPageMarkdownUrl, getPageSourceMarkdown, resolveMarkdownPage, source } from "@/lib/source";
import { notFound } from "next/navigation";

export const revalidate = false;

/**
 * Serve byte-identical source markdown (YAML frontmatter stripped).
 * Canonical: `/llms.mdx/docs/⟨slug⟩`. Also accepts `/content.md` and `.md`.
 */
export async function GET(_req: Request, { params }: RouteContext<"/llms.mdx/docs/[[...slug]]">) {
  const { slug } = await params;
  const page = resolveMarkdownPage(slug);
  if (!page) notFound();

  return new Response(await getPageSourceMarkdown(page), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}

export function generateStaticParams() {
  return source.getPages().flatMap((page) => {
    const canonical = { slug: getPageMarkdownUrl(page).segments };
    const legacy = { slug: [...page.slugs, "content.md"] };
    const dotted =
      page.slugs.length > 0
        ? { slug: [...page.slugs.slice(0, -1), `${page.slugs.at(-1)}.md`] }
        : { slug: ["index.md"] };
    return [canonical, legacy, dotted];
  });
}
