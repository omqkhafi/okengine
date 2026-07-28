/**
 * Landing code panel — Shiki-highlighted source with a filename tab.
 *
 * Uses the same highlighter as the docs code blocks so a snippet on the
 * homepage and the same snippet in the handbook read identically.
 */

import { highlight } from "fumadocs-core/highlight";
import type { ReactNode } from "react";

/**
 * Static code panel.
 *
 * @param code - Source text to highlight
 * @param title - Filename or label shown in the panel header
 * @param lang - Shiki language id
 * @param footer - Optional note rendered under the code
 */
export async function CodePanel({
  code,
  title,
  lang = "ts",
  footer,
}: {
  code: string;
  title: string;
  lang?: string;
  footer?: ReactNode;
}) {
  const rendered = await highlight(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });

  return (
    <figure className="not-prose m-0 w-full overflow-hidden rounded-xl border border-fd-border bg-fd-card">
      <figcaption className="flex items-center gap-2 border-b border-fd-border px-4 py-2.5 font-mono text-[11px] text-fd-muted-foreground">
        {title}
      </figcaption>
      <div className="[&_pre]:overflow-x-auto [&_pre]:bg-transparent [&_pre]:py-4 [&_pre]:text-xs [&_pre]:leading-relaxed sm:[&_pre]:text-[13px]">
        {rendered}
      </div>
      {footer ? (
        <div className="border-t border-fd-border px-4 py-2.5 text-[11px] text-fd-muted-foreground">
          {footer}
        </div>
      ) : null}
    </figure>
  );
}
