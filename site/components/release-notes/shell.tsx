/**
 * Changelog two-panel shell — same 30/70 split the header brand cell matches.
 * Adapted from better-auth/better-auth `docs/app/changelog/page.tsx` under the
 * MIT License. Copyright (c) 2024 - present, Bereket Engida. See site/NOTICE.
 */

import type { ReactNode } from "react";
import { ExternalArrow } from "@/components/chrome/icons";
import { CHANGELOG_SOURCE, type ChangelogRelease } from "@/lib/changelog";
import { githubBlobUrl } from "@/lib/shared";

/**
 * Sticky left rail + release stream.
 *
 * @param latest - Newest published release (rail "latest" row)
 * @param children - Right-pane stream
 */
export function ChangelogShell({
  latest,
  children,
}: {
  readonly latest: ChangelogRelease;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="flex min-h-[calc(100dvh-var(--landing-topbar-height))] flex-col text-fd-foreground lg:flex-row">
      <div className="hidden shrink-0 border-fd-border px-5 sm:px-6 lg:sticky lg:top-(--landing-topbar-height) lg:block lg:h-[calc(100dvh-var(--landing-topbar-height))] lg:w-[30%] lg:border-r lg:px-10">
        <div className="flex h-full flex-col justify-center py-16">
          <p className="font-mono text-[11px] tracking-[0.16em] text-fd-muted-foreground uppercase">
            changelog
          </p>
          <h1 className="mt-4 text-2xl leading-tight tracking-tight text-balance md:text-3xl xl:text-4xl">
            Every release, newest first
          </h1>
          <p className="mt-4 max-w-[260px] text-sm leading-relaxed text-fd-muted-foreground">
            Written down before it is announced. The page is generated from{" "}
            <code className="font-mono text-fd-foreground">{CHANGELOG_SOURCE}</code> in the repo.
          </p>

          <dl className="mt-8 flex items-baseline gap-3 border-b border-dashed border-fd-foreground/[0.12] pb-2">
            <dt className="font-mono text-[11px] tracking-[0.16em] text-fd-muted-foreground uppercase">
              latest
            </dt>
            <dd className="ml-auto font-mono text-sm text-fd-foreground">{latest.tag}</dd>
          </dl>

          <a
            href={githubBlobUrl(CHANGELOG_SOURCE)}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-4 inline-flex w-fit items-center gap-1.5 font-mono text-[11px] tracking-[0.16em] text-fd-muted-foreground uppercase transition-colors hover:text-fd-foreground"
          >
            source
            <ExternalArrow className="size-2.5 opacity-60" />
          </a>
        </div>
      </div>

      <div className="flex w-full flex-col lg:w-[70%]">{children}</div>
    </div>
  );
}
