/**
 * Overlay ink for {@link QueryEditor} — one span per token, same metrics as the textarea.
 */

import type { JSX } from "react";
import { cn } from "@/lib/utils.ts";
import {
  highlightQuery,
  type QueryHighlightKind,
  type QueryHighlightLanguage,
} from "../lib/query-highlight.ts";

/** Props for {@link QueryHighlightView}. */
export interface QueryHighlightViewProps {
  readonly code: string;
  readonly language: QueryHighlightLanguage;
  readonly className?: string;
}

const KIND_CLASS: Record<QueryHighlightKind, string> = {
  text: "text-foreground/90",
  comment: "italic text-muted-foreground/55",
  keyword: "text-rose-600 dark:text-rose-400",
  command: "text-amber-600 dark:text-amber-400",
  string: "text-sky-700 dark:text-sky-300",
  ident: "text-teal-700 dark:text-teal-300",
  number: "text-violet-600 dark:text-violet-400",
  punct: "text-muted-foreground/80",
  operator: "text-fuchsia-600 dark:text-fuchsia-400",
  atom: "text-amber-700 dark:text-amber-300",
};

/**
 * Language-aware token paint. SQL keywords vs KV commands use different ink.
 *
 * @param props - Buffer + grammar
 */
export function QueryHighlightView({
  code,
  language,
  className,
}: QueryHighlightViewProps): JSX.Element {
  const tokens = highlightQuery(code, language);
  return (
    <pre
      aria-hidden
      data-slot="store-query-highlight"
      data-language={language}
      className={cn(
        "m-0 overflow-visible whitespace-pre font-mono text-xs leading-5 text-foreground/90",
        className,
      )}
    >
      {tokens.map((token, index) => (
        <span key={`${index}-${token.kind}`} className={KIND_CLASS[token.kind]}>
          {token.text}
        </span>
      ))}
    </pre>
  );
}
