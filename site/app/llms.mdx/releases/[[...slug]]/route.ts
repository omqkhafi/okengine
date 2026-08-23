import {
  changelogSeriesBySlug,
  loadChangelogSeries,
  renderChangelogIndexMarkdown,
  renderChangelogSeriesMarkdown,
} from "@/lib/changelog";
import { markdownResponse } from "@/lib/markdown-response";
import { markdownNotFoundResponse } from "@/lib/not-found-markdown";

export const revalidate = false;

/**
 * Markdown twins of `/changelog` and `/changelog/{series}`.
 * Path is `/llms.mdx/releases` so it does not collide with the HTML `/changelog` tree.
 */
export async function GET(
  _req: Request,
  { params }: RouteContext<"/llms.mdx/releases/[[...slug]]">,
) {
  const { slug } = await params;
  const series = loadChangelogSeries();
  const parts = slug ?? [];

  if (parts.length === 0) {
    return markdownResponse(renderChangelogIndexMarkdown(series));
  }
  if (parts.length === 1) {
    const entry = changelogSeriesBySlug(series, parts[0]!);
    if (!entry) return markdownNotFoundResponse();
    return markdownResponse(renderChangelogSeriesMarkdown(entry));
  }
  return markdownNotFoundResponse();
}

export function generateStaticParams() {
  const series = loadChangelogSeries();
  return [{ slug: [] }, ...series.map((entry) => ({ slug: [entry.slug] }))];
}
