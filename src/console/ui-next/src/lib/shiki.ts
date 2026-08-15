/**
 * Slim Shiki highlighter — Console languages only, JS engine (no Oniguruma WASM).
 */

import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/** Languages the Console actually highlights. */
export const CONSOLE_SHIKI_LANGS = ["bash", "json", "sql", "tsx", "typescript"] as const;

/** Themes the Console actually paints. */
export const CONSOLE_SHIKI_THEMES = ["github-light", "github-dark"] as const;

/** Grammar id accepted by {@link getConsoleHighlighter}. */
export type ConsoleShikiLang = (typeof CONSOLE_SHIKI_LANGS)[number];

/** Theme id accepted by {@link getConsoleHighlighter}. */
export type ConsoleShikiTheme = (typeof CONSOLE_SHIKI_THEMES)[number];

let highlighterPromise: Promise<HighlighterCore> | null = null;

/**
 * Shared HighlighterCore. First call loads the five grammars + two themes.
 *
 * @returns Promise of the process-wide highlighter
 */
export function getConsoleHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      langs: [
        import("shiki/langs/bash.mjs"),
        import("shiki/langs/json.mjs"),
        import("shiki/langs/sql.mjs"),
        import("shiki/langs/tsx.mjs"),
        import("shiki/langs/typescript.mjs"),
      ],
      themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  }
  return highlighterPromise;
}
