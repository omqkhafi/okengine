/**
 * Shiki SPA helper — client-side highlight via the slim Console highlighter.
 */

import type { JSX } from "react";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { getConsoleHighlighter, type ConsoleShikiLang, type ConsoleShikiTheme } from "./shiki.ts";

/** Options for {@link highlightCode}. */
export type HighlightCodeOptions = {
  /** Console language id (default `typescript`). */
  readonly lang?: ConsoleShikiLang;
  /** Console theme id (default `github-light`). */
  readonly theme?: ConsoleShikiTheme;
};

/**
 * Highlight source to React elements (JSX runtime, never raw HTML).
 *
 * @param code - Source text
 * @param options - Language / theme, or a bare language id for back-compat
 */
export async function highlightCode(
  code: string,
  options: HighlightCodeOptions | ConsoleShikiLang = {},
): Promise<JSX.Element> {
  const opts: HighlightCodeOptions = typeof options === "string" ? { lang: options } : options;
  const highlighter = await getConsoleHighlighter();
  const hast = highlighter.codeToHast(code, {
    lang: opts.lang ?? "typescript",
    theme: opts.theme ?? "github-light",
  });
  return toJsxRuntime(hast, {
    Fragment,
    jsx,
    jsxs,
  }) as JSX.Element;
}
