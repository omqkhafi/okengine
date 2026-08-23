/**
 * Changelog index — lists minor-version pages generated from changelog.md.
 * Layout adapted from better-auth/better-auth `docs/app/changelog/page.tsx`
 * under the MIT License. Copyright (c) 2024 - present, Bereket Engida.
 * See site/NOTICE.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ChangelogShell } from "@/components/release-notes/shell";
import { CHANGELOG_SOURCE, changelogSeriesPath, loadChangelogSeries } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Every published okengine release, newest first.",
  alternates: {
    types: {
      "text/markdown": "/llms.mdx/releases",
    },
  },
};

export default function ChangelogPage() {
  const series = loadChangelogSeries();
  const latest = series[0]!.releases[0]!;

  return (
    <ChangelogShell latest={latest}>
      <div className="px-5 pt-8 lg:p-8 lg:pt-16">
        <h2 className="flex items-center gap-3 font-mono text-sm text-fd-foreground">
          RELEASES
          <span aria-hidden className="h-px flex-1 bg-fd-foreground/15" />
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-fd-muted-foreground lg:hidden">
          Every published okengine release, newest first.
        </p>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-fd-muted-foreground">
          Split by minor version from{" "}
          <code className="font-mono text-fd-foreground">{CHANGELOG_SOURCE}</code>.
        </p>
      </div>

      {series.map((entry) => {
        const newest = entry.releases[0]!;
        const oldest = entry.releases[entry.releases.length - 1]!;
        const n = entry.releases.length;
        return (
          <article
            key={entry.slug}
            className="border-b border-dashed border-fd-border px-5 py-8 sm:px-6 lg:px-8"
          >
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-2xl font-medium tracking-tight text-fd-foreground">
                <Link href={changelogSeriesPath(entry.slug)} className="hover:underline">
                  {entry.slug}
                </Link>
              </h2>
              <time
                dateTime={newest.date}
                className="ml-auto shrink-0 font-mono text-xs tracking-tight text-fd-muted-foreground"
              >
                {newest.date === oldest.date ? newest.date : `${oldest.date} – ${newest.date}`}
              </time>
            </header>
            <p className="mt-3 text-sm text-fd-muted-foreground">
              {n} {n === 1 ? "release" : "releases"}
            </p>
          </article>
        );
      })}
    </ChangelogShell>
  );
}
