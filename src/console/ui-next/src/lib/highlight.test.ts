/**
 * Slim Console highlighter — JSON + TypeScript, no web-bundle grammars.
 */

import { describe, expect, test } from "bun:test";
import { CONSOLE_SHIKI_LANGS, CONSOLE_SHIKI_THEMES, getConsoleHighlighter } from "./shiki.ts";

describe("getConsoleHighlighter", () => {
  test("highlights JSON with the slim grammar set", async () => {
    const highlighter = await getConsoleHighlighter();
    const html = highlighter.codeToHtml('{"ok":true}', {
      lang: "json",
      theme: "github-light",
    });
    expect(html).toContain("<pre");
    expect(html).toContain("ok");
    expect(CONSOLE_SHIKI_LANGS).toContain("json");
    expect(CONSOLE_SHIKI_THEMES).toContain("github-light");
  });

  test("highlights TypeScript", async () => {
    const highlighter = await getConsoleHighlighter();
    const html = highlighter.codeToHtml("const x = 1;", {
      lang: "typescript",
      theme: "github-dark",
    });
    expect(html).toContain("<pre");
    expect(html).toContain("const");
  });
});
