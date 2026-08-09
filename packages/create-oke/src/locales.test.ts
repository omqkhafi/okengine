/**
 * Locale parsing + scaffold apply helpers.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyLocalesToProject,
  formatI18nConfig,
  formatLocalesIndex,
  parseExtraLocales,
  replaceI18nConfig,
  stripLegacyAppLocaleImports,
} from "./locales.ts";

describe("parseExtraLocales", () => {
  test("parses ar and ar,fr", () => {
    expect(parseExtraLocales("ar")).toEqual(["ar"]);
    expect(parseExtraLocales("ar,fr")).toEqual(["ar", "fr"]);
    expect(parseExtraLocales(" AR ; fr ")).toEqual(["ar", "fr"]);
  });

  test("drops en and duplicates", () => {
    expect(parseExtraLocales("en,ar,en,ar")).toEqual(["ar"]);
  });

  test("rejects empty / invalid", () => {
    expect(parseExtraLocales("")).toBeNull();
    expect(parseExtraLocales("1ar")).toBeNull();
  });
});

describe("formatI18nConfig", () => {
  test("English-only omits dir", () => {
    expect(formatI18nConfig(["en"])).toBe('i18n: { locales: ["en"], default: "en" }');
  });

  test("Arabic adds rtl dir", () => {
    expect(formatI18nConfig(["en", "ar"])).toBe(
      'i18n: { locales: ["en", "ar"], default: "en", dir: { "ar": "rtl" } }',
    );
  });
});

describe("formatLocalesIndex", () => {
  test("lists en then extras as relative imports", () => {
    const src = formatLocalesIndex(["en", "ar", "fr"]);
    expect(src).toContain('import "./en";');
    expect(src).toContain('import "./ar";');
    expect(src).toContain('import "./fr";');
    expect(src.match(/import "\.\//g)?.length).toBe(3);
  });
});

describe("stripLegacyAppLocaleImports", () => {
  test("removes @/ and ./ per-locale imports", () => {
    const src = `import "@/core";
import "@/locales/en";
import "./locales/ar";

import { oke } from "okengine/http";
`;
    const next = stripLegacyAppLocaleImports(src);
    expect(next).not.toContain('import "@/locales/');
    expect(next).not.toContain('import "./locales/');
    expect(next).toContain('import "@/core";');
    expect(next).toContain('import { oke } from "okengine/http";');
  });
});

describe("replaceI18nConfig", () => {
  test("replaces nested dir block", () => {
    const src = `export default defineConfig({
  i18n: { locales: ["en", "ar"], default: "en", dir: { ar: "rtl" } },
});
`;
    const next = replaceI18nConfig(src, ["en"]);
    expect(next).toContain('i18n: { locales: ["en"], default: "en" }');
    expect(next).not.toContain("dir:");
  });
});

describe("applyLocalesToProject", () => {
  test("adds ar + fr files and updates locales index", () => {
    const dir = mkdtempSync(join(tmpdir(), "oke-locales-"));
    try {
      mkdirSync(join(dir, "src/locales"), { recursive: true });
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(
        join(dir, "oke.config.ts"),
        `export default defineConfig({\n  i18n: { locales: ["en"], default: "en" },\n});\n`,
        "utf8",
      );
      writeFileSync(
        join(dir, "src/app.ts"),
        `import "@/core";\n\nexport const app = {};\n`,
        "utf8",
      );
      writeFileSync(
        join(dir, "src/core.ts"),
        `export const noteCreatedMail = mail.template("note-created", {\n  locales: ["en"],\n});\n`,
        "utf8",
      );
      writeFileSync(join(dir, "src/locales/en.ts"), "export const en = {};\n", "utf8");
      writeFileSync(join(dir, "src/locales/index.ts"), formatLocalesIndex(["en"]), "utf8");

      applyLocalesToProject(dir, ["ar", "fr"]);

      expect(readFileSync(join(dir, "oke.config.ts"), "utf8")).toContain('"ar"');
      expect(readFileSync(join(dir, "oke.config.ts"), "utf8")).toContain('"fr"');
      expect(readFileSync(join(dir, "oke.config.ts"), "utf8")).toContain('"ar": "rtl"');
      const index = readFileSync(join(dir, "src/locales/index.ts"), "utf8");
      expect(index).toContain('import "./en";');
      expect(index).toContain('import "./ar";');
      expect(index).toContain('import "./fr";');
      expect(readFileSync(join(dir, "src/app.ts"), "utf8")).not.toContain('import "@/locales/');
      expect(readFileSync(join(dir, "src/locales/ar.ts"), "utf8")).toContain("غير موجود");
      expect(readFileSync(join(dir, "src/locales/fr.ts"), "utf8")).toContain("TODO: translate");
      expect(readFileSync(join(dir, "src/core.ts"), "utf8")).toContain(
        'locales: ["en", "ar", "fr"]',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
