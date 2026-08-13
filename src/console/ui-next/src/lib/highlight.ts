/**
 * Shiki SPA helper — client-side highlight via web bundle + JSX runtime.
 */

import type { JSX } from "react";
import type { BundledLanguage, BundledTheme } from "shiki/bundle/web";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { codeToHast } from "shiki/bundle/web";

/** Options for {@link highlightCode}. */
export type HighlightCodeOptions = {
  /** Bundled language id (default `typescript`). */
  readonly lang?: BundledLanguage;
  /** Bundled theme id (default `github-light`). */
  readonly theme?: BundledTheme;
};

/**
 * Highlight source to React elements (no dangerouslySetInnerHTML).
 *
 * @param code - Source text
 * @param options - Language / theme, or a bare language id for back-compat
 */
export async function highlightCode(
  code: string,
  options: HighlightCodeOptions | BundledLanguage = {},
): Promise<JSX.Element> {
  const opts: HighlightCodeOptions = typeof options === "string" ? { lang: options } : options;
  const hast = await codeToHast(code, {
    lang: opts.lang ?? "typescript",
    theme: opts.theme ?? "github-light",
  });
  return toJsxRuntime(hast, {
    Fragment,
    jsx,
    jsxs,
  }) as JSX.Element;
}
