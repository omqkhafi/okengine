import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONSOLE_DOCUMENT_DESCRIPTION,
  CONSOLE_DOCUMENT_TITLE,
  consoleDocumentTitle,
} from "./document-meta.ts";

const here = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(here, "../../index.html"), "utf8");

describe("consoleDocumentTitle", () => {
  test("gate uses the default title", () => {
    expect(consoleDocumentTitle("/")).toBe(CONSOLE_DOCUMENT_TITLE);
    expect(consoleDocumentTitle("")).toBe(CONSOLE_DOCUMENT_TITLE);
  });

  test("modules prefix the page name", () => {
    expect(consoleDocumentTitle("/overview")).toBe(`Overview · ${CONSOLE_DOCUMENT_TITLE}`);
    expect(consoleDocumentTitle("/flows")).toBe(`Flows · ${CONSOLE_DOCUMENT_TITLE}`);
    expect(consoleDocumentTitle("/store")).toBe(`Store · ${CONSOLE_DOCUMENT_TITLE}`);
    expect(consoleDocumentTitle("/observability")).toBe(
      `Observability · ${CONSOLE_DOCUMENT_TITLE}`,
    );
    expect(consoleDocumentTitle("/vault")).toBe(`Vault · ${CONSOLE_DOCUMENT_TITLE}`);
    expect(consoleDocumentTitle("/monitoring")).toBe(`Observability · ${CONSOLE_DOCUMENT_TITLE}`);
  });

  test("unknown paths are not found", () => {
    expect(consoleDocumentTitle("/nope")).toBe(`Not found · ${CONSOLE_DOCUMENT_TITLE}`);
  });
});

describe("index.html document meta", () => {
  test("title, description, and favicon match the Console brand", () => {
    expect(indexHtml).toContain(`<title>${CONSOLE_DOCUMENT_TITLE}</title>`);
    expect(indexHtml).toContain(`content="${CONSOLE_DOCUMENT_DESCRIPTION}"`);
    expect(indexHtml).toContain('href="/favicon.svg"');
    expect(indexHtml).not.toContain("oke Console");
  });
});
