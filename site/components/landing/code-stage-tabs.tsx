/**
 * Cloudflare-style filename tabs + caption row over pre-highlighted sources.
 */

"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useClientReducedMotion } from "@/lib/use-client-reduced-motion";

/** One file in the homepage code stage. */
export type CodeStageFile = {
  readonly id: string;
  readonly filename: string;
  readonly caption: string;
  readonly body: string;
  readonly code: string;
  readonly lang?: string;
};

/**
 * Client tab strip for {@link CodeStage}. All sources are highlighted on the
 * server; this only switches which pane is visible.
 *
 * @param files - Filename, caption, and source metadata
 * @param highlighted - Shiki output, same order as `files`
 */
export function CodeStageTabs({
  files,
  highlighted,
}: {
  readonly files: ReadonlyArray<CodeStageFile>;
  readonly highlighted: ReadonlyArray<ReactNode>;
}): ReactNode {
  const reduced = useClientReducedMotion();
  const [activeId, setActiveId] = useState<string>(files[0]?.id ?? "");
  const activeIndex = Math.max(
    0,
    files.findIndex((file) => file.id === activeId),
  );
  const active = files[activeIndex] ?? files[0];

  if (!active) return null;

  return (
    <MotionConfig reducedMotion="never">
      <figure className="not-prose m-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card">
        <div
          role="tablist"
          aria-label="Starter files"
          className="flex flex-wrap items-center gap-1 border-b border-fd-border px-2"
        >
          {files.map((file) => {
            const selected = file.id === active.id;
            return (
              <button
                key={file.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveId(file.id)}
                className={cn(
                  "relative px-3 py-2.5 font-mono text-xs transition-colors",
                  selected
                    ? "text-fd-foreground"
                    : "text-fd-muted-foreground hover:text-fd-foreground",
                )}
              >
                {file.filename}
                {selected ? (
                  <span className="absolute inset-x-2 -bottom-px h-px bg-fd-foreground" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="min-h-[18rem] [&_pre]:overflow-x-auto [&_pre]:bg-transparent [&_pre]:px-4 [&_pre]:py-4 [&_pre]:text-xs [&_pre]:leading-relaxed sm:min-h-[22rem] sm:[&_pre]:text-[13px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={active.id}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              {highlighted[activeIndex]}
            </motion.div>
          </AnimatePresence>
        </div>

        <figcaption className="grid gap-px border-t border-fd-border bg-fd-border sm:grid-cols-3">
          {files.map((file) => {
            const selected = file.id === active.id;
            return (
              <button
                key={`${file.id}-caption`}
                type="button"
                onClick={() => setActiveId(file.id)}
                className={cn(
                  "flex flex-col gap-1.5 bg-fd-card px-4 py-4 text-left transition-colors",
                  selected ? "bg-fd-secondary/40" : "hover:bg-fd-secondary/25",
                )}
              >
                <span className="font-mono text-[11px] tracking-[0.14em] text-fd-muted-foreground uppercase">
                  {file.caption}
                </span>
                <span
                  className={cn(
                    "text-sm leading-relaxed text-pretty",
                    selected ? "text-fd-foreground" : "text-fd-muted-foreground",
                  )}
                >
                  {file.body}
                </span>
              </button>
            );
          })}
        </figcaption>
      </figure>
    </MotionConfig>
  );
}
