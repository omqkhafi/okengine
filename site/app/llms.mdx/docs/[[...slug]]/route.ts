import { getPageMarkdownUrl, getPageSourceMarkdown, source } from "@/lib/source";
import { notFound } from "next/navigation";

export const revalidate = false;

/**
 * Serve byte-identical source markdown (YAML frontmatter stripped).
 */
export async function GET(_req: Request, { params }: RouteContext<"/llms.mdx/docs/[[...slug]]">) {
  const { slug } = await params;
  // remove the appended "content.md"
  const page = source.getPage(slug?.slice(0, -1));
  if (!page) notFound();

  return new Response(await getPageSourceMarkdown(page), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    slug: getPageMarkdownUrl(page).segments,
  }));
}
