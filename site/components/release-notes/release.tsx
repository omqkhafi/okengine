/**
 * One changelog release block. Adapted from better-auth/better-auth
 * `docs/app/changelog/page.tsx` under the MIT License.
 * Copyright (c) 2024 - present, Bereket Engida. See site/NOTICE.
 */

import type { ReactNode } from "react";
import { splitInlineCode, type ChangelogGroup, type ChangelogRelease } from "@/lib/changelog";

/** Render a bullet with its `code` runs. */
function Bullet({ text }: { readonly text: string }): ReactNode {
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
function GroupBlock({ group }: { readonly group: ChangelogGroup }): ReactNode {
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

/**
 * One release block: tag, date, optional summary, then grouped bullets.
 *
 * @param release - Parsed release
 */
export function Release({ release }: { readonly release: ChangelogRelease }): ReactNode {
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
