/**
 * Shiki SPA helper — client-side highlight via web bundle + JSX runtime.
 * Wired for later panels; claim page does not use it yet.
 */

import type { JSX } from "react";
import type { BundledLanguage } from "shiki/bundle/web";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { codeToHast } from "shiki/bundle/web";

/**
 * Highlight source to React elements (no dangerouslySetInnerHTML).
 *
 * @param code - Source text
 * @param lang - Bundled language id
 */
export async function highlightCode(
  code: string,
  lang: BundledLanguage = "typescript",
): Promise<JSX.Element> {
  const hast = await codeToHast(code, {
    lang,
    theme: "github-light",
  });
  return toJsxRuntime(hast, {
    Fragment,
    jsx,
    jsxs,
  }) as JSX.Element;
}
