/**
 * Changelog surface. Two-panel layout (sticky left rail, release stream on the
 * right) adapted from better-auth/better-auth `docs/app/changelog/page.tsx`
 * under the MIT License. Copyright (c) 2024 - present, Bereket Engida.
 * See site/NOTICE.
 *
 * Content comes from the committed root `changelog.md`, not the GitHub releases
 * API, so the static export is deterministic.
 */

import type { Metadata } from "next";
import { ExternalArrow } from "@/components/chrome/icons";
import {
  CHANGELOG_SOURCE,
  loadChangelog,
  splitInlineCode,
  type ChangelogGroup,
  type ChangelogRelease,
} from "@/lib/changelog";
import { githubBlobUrl } from "@/lib/shared";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Every published okengine release, newest first.",
};

/** Render a bullet with its `code` runs. */
function Bullet({ text }: { text: string }) {
  return (
    <li className="relative flex gap-2.5 text-sm leading-relaxed text-fd-muted-foreground">
      <span aria-hidden className="pt-px font-mono text-fd-foreground/30 select-none">
        —
      </span>
      <span className="min-w-0">
        {splitInlineCode(text).map((segment, index) =>
          segment.code ? (
            <code
              key={index}
              className="rounded-sm bg-fd-muted px-1 py-0.5 font-mono text-[0.85em] text-fd-foreground"
            >
              {segment.text}
            </code>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
      </span>
    </li>
  );
}

/** One `###` group, with optional `####` area subgroups. */
function GroupBlock({ group }: { group: ChangelogGroup }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="flex items-center gap-3 font-mono text-[11px] tracking-[0.16em] text-fd-foreground/70 uppercase">
        {group.label}
        <span aria-hidden className="h-px flex-1 bg-fd-border" />
      </h3>
      {group.items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {group.items.map((item) => (
            <Bullet key={item} text={item} />
          ))}
        </ul>
      ) : null}
      {group.subgroups.map((sub) => (
        <div key={sub.label} className="flex flex-col gap-2">
          <h4 className="font-mono text-[11px] tracking-[0.12em] text-fd-muted-foreground">
            {sub.label}
          </h4>
          <ul className="flex flex-col gap-2">
            {sub.items.map((item) => (
              <Bullet key={item} text={item} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** One release block: tag, date, optional summary, then grouped bullets. */
function Release({ release }: { release: ChangelogRelease }) {
  return (
    <article className="border-b border-dashed border-fd-border px-5 py-12 first:pt-8 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-2xl font-medium tracking-tight text-fd-foreground">{release.tag}</h2>
        <time
          dateTime={release.date}
          className="ml-auto shrink-0 font-mono text-xs tracking-tight text-fd-muted-foreground"
        >
          {release.date}
        </time>
      </header>

      {release.summary.map((line) => (
        <p key={line} className="mb-5 max-w-2xl text-sm leading-relaxed text-fd-muted-foreground">
          {line}
        </p>
      ))}

      <div className="flex flex-col gap-6">
        {release.groups.map((group) => (
          <GroupBlock key={group.label} group={group} />
        ))}
      </div>
    </article>
  );
}

export default function ChangelogPage() {
  const releases = loadChangelog();
  const latest = releases[0]!;

  return (
    <div className="flex min-h-[calc(100dvh-var(--landing-topbar-height))] flex-col text-fd-foreground lg:flex-row">
      {/* Left rail — mirrors the header's brand-cell width, sticks under the topbar. */}
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

      {/* Release stream. */}
      <div className="flex w-full flex-col lg:w-[70%]">
        <div className="px-5 pt-8 lg:p-8 lg:pt-16">
          <h2 className="flex items-center gap-3 font-mono text-sm text-fd-foreground">
            RELEASES
            <span aria-hidden className="h-px flex-1 bg-fd-foreground/15" />
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-fd-muted-foreground lg:hidden">
            Every published okengine release, newest first.
          </p>
        </div>

        {releases.map((release) => (
          <Release key={release.tag} release={release} />
        ))}
      </div>
    </div>
  );
}
