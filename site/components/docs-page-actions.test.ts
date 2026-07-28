/**
 * Gate: Open-in helpers only emit documented Cursor deeplinks.
 */

import { describe, expect, test } from "bun:test";
import { cursorPromptForMarkdown, cursorPromptHref } from "./docs-page-actions";

describe("honest docs page actions", () => {
  test("cursor deeplink uses the documented prompt URL scheme", () => {
    const prompt = cursorPromptForMarkdown(
      "https://example.com/llms.mdx/docs/get-started/introduction/content.md",
    );
    expect(prompt).toContain(
      "https://example.com/llms.mdx/docs/get-started/introduction/content.md",
    );
    const href = cursorPromptHref(prompt);
    expect(href.startsWith("https://cursor.com/link/prompt?")).toBe(true);
    expect(href).not.toContain("chatgpt.com");
    expect(href).not.toContain("claude.ai");
    expect(href).not.toContain("scira.ai");
  });
});
