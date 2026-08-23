/**
 * One minor-version changelog page, generated from changelog.md.
 * Layout adapted from better-auth/better-auth `docs/app/changelog/page.tsx`
 * under the MIT License. Copyright (c) 2024 - present, Bereket Engida.
 * See site/NOTICE.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Release } from "@/components/release-notes/release";
import { ChangelogShell } from "@/components/release-notes/shell";
import { changelogSeriesBySlug, changelogSeriesPath, loadChangelogSeries } from "@/lib/changelog";

export const dynamicParams = false;

export function generateStaticParams() {
  return loadChangelogSeries().map((entry) => ({ series: entry.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/changelog/[series]">): Promise<Metadata> {
  const { series: slug } = await params;
  const series = changelogSeriesBySlug(loadChangelogSeries(), slug);
  if (!series) notFound();
  return {
    title: `Changelog ${series.slug}`,
    description: `okengine ${series.slug} release notes.`,
    alternates: {
      types: {
        "text/markdown": `/llms.mdx/releases/${series.slug}`,
      },
    },
  };
}

export default async function ChangelogSeriesPage({ params }: PageProps<"/changelog/[series]">) {
  const { series: slug } = await params;
  const all = loadChangelogSeries();
  const series = changelogSeriesBySlug(all, slug);
  if (!series) notFound();
  const latest = all[0]!.releases[0]!;
  const index = all.findIndex((entry) => entry.slug === series.slug);
  const newer = index > 0 ? all[index - 1] : undefined;
  const older = index >= 0 && index < all.length - 1 ? all[index + 1] : undefined;

  return (
    <ChangelogShell latest={latest}>
      <div className="px-5 pt-8 lg:p-8 lg:pt-16">
        <h2 className="flex items-center gap-3 font-mono text-sm text-fd-foreground">
          {series.slug}
          <span aria-hidden className="h-px flex-1 bg-fd-foreground/15" />
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-fd-muted-foreground lg:hidden">
          Every published okengine release, newest first.
        </p>
        <p className="mt-3 font-mono text-xs text-fd-muted-foreground">
          <Link href="/changelog" className="hover:text-fd-foreground">
            all series
          </Link>
          {newer ? (
            <>
              {" · "}
              <Link href={changelogSeriesPath(newer.slug)} className="hover:text-fd-foreground">
                {newer.slug}
              </Link>
            </>
          ) : null}
          {older ? (
            <>
              {" · "}
              <Link href={changelogSeriesPath(older.slug)} className="hover:text-fd-foreground">
                {older.slug}
              </Link>
            </>
          ) : null}
        </p>
      </div>

      {series.releases.map((release) => (
        <Release key={release.tag} release={release} />
      ))}
    </ChangelogShell>
  );
}
