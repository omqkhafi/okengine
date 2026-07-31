import { DocsPageActions } from "@/components/docs-page-actions";
import { getMDXComponents } from "@/components/mdx";
import { getPageImageUrl, getPageMarkdownUrl, source } from "@/lib/source";
import { githubBlobUrl } from "@/lib/shared";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "@fumadocs/base-ui/layouts/docs/page";
import { createRelativeLink } from "@fumadocs/base-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;
  const sourcePath =
    typeof page.data.source === "string" && page.data.source.length > 0
      ? page.data.source
      : `site/content/docs/${page.path}`;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <DocsPageActions markdownUrl={markdownUrl} githubUrl={githubBlobUrl(sourcePath)} />
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImageUrl(page).url,
    },
  };
}
