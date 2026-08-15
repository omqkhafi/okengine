/**
 * Shared Shiki-highlighted JSON viewer (Traces + Units Call API).
 */

import { useEffect, useMemo, useState, type JSX } from "react";
import { useTheme } from "@/components/theme-provider";
import { highlightCode } from "@/lib/highlight.ts";

/** Props for {@link HighlightedJson}. */
export interface HighlightedJsonProps {
  /** Pre-serialized JSON text. */
  readonly json: string;
  /** `data-slot` for tests / a11y. */
  readonly dataSlot: string;
  /** Optional max height class (default matches Traces). */
  readonly className?: string;
}

/**
 * Shiki-highlighted JSON block with line numbers.
 *
 * @param props - Pre-serialized JSON
 */
export function HighlightedJson({ json, dataSlot, className }: HighlightedJsonProps): JSX.Element {
  const { theme } = useTheme();
  const [painted, setPainted] = useState<{
    readonly json: string;
    readonly nodes: JSX.Element;
  } | null>(null);
  const lines = useMemo(() => json.split("\n"), [json]);
  const nodes = painted?.json === json ? painted.nodes : null;

  useEffect(() => {
    let cancelled = false;
    const root = window.document.documentElement;
    const dark = theme === "dark" || (theme === "system" && root.classList.contains("dark"));
    void highlightCode(json, {
      lang: "json",
      theme: dark ? "github-dark" : "github-light",
    }).then((el) => {
      if (!cancelled) setPainted({ json, nodes: el });
    });
    return () => {
      cancelled = true;
    };
  }, [json, theme]);

  return (
    <div
      data-slot={dataSlot}
      className={
        className ??
        "flex max-h-56 overflow-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      }
    >
      <div
        className="sticky left-0 select-none border-r border-border/40 bg-muted/30 px-1.5 py-1.5 text-right font-mono text-[10px] leading-snug text-muted-foreground/80"
        aria-hidden
      >
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <div className="min-w-0 flex-1 px-2 py-1.5 text-[11px] leading-snug [&_pre]:m-0 [&_pre]:bg-transparent! [&_code]:font-mono">
        {nodes ?? (
          <pre className="m-0 bg-transparent font-mono text-[11px] leading-snug whitespace-pre">
            {json}
          </pre>
        )}
      </div>
    </div>
  );
}
