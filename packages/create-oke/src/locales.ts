/**
 * Extra locales for create-oke — English is always the default.
 *
 * Templates ship English-only. Optional tags (ar, fr, …) are applied after
 * copy: config, channel templates, `src/locales/index.ts`, and locale modules.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** Default locale — always present, never removed. */
export const DEFAULT_LOCALE = "en";

/** Known RTL tags written into `i18n.dir`. */
export const RTL_LOCALES: ReadonlySet<string> = new Set(["ar", "he", "fa", "ur"]);

/**
 * Normalize a raw locale tag (trim, lowercase language, keep region case).
 *
 * @param raw - User input (`AR`, `fr-FR`, …)
 */
export function normalizeLocaleTag(raw: string): string {
  const trimmed = raw.trim().replaceAll("_", "-");
  if (!trimmed) return "";
  const [lang, ...rest] = trimmed.split("-");
  if (!lang) return "";
  const base = lang.toLowerCase();
  if (rest.length === 0) return base;
  return [base, ...rest.map((p, i) => (i === 0 ? p.toUpperCase() : p))].join("-");
}

/**
 * Parse a comma/space-separated locale list. Drops `en` (always implied) and
 * duplicates. Returns `null` when the input is empty or invalid.
 *
 * @param raw - e.g. `ar` or `ar,fr`
 */
export function parseExtraLocales(raw: string): readonly string[] | null {
  const parts = raw
    .split(/[,;\s]+/)
    .map((p) => normalizeLocaleTag(p))
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of parts) {
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(tag)) return null;
    if (tag === DEFAULT_LOCALE || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/**
 * Full locale list for config / channels (`en` first, then extras).
 *
 * @param extra - Extra tags beyond English
 */
export function localesWithDefault(extra: readonly string[] = []): readonly string[] {
  const extras = parseExtraLocales(extra.join(",")) ?? [];
  return [DEFAULT_LOCALE, ...extras];
}

/**
 * `i18n.dir` map for RTL extras (omitted when empty).
 *
 * @param locales - Full locale list including `en`
 */
export function dirMapForLocales(locales: readonly string[]): Readonly<Record<string, "rtl">> {
  const dir: Record<string, "rtl"> = {};
  for (const tag of locales) {
    const base = tag.split("-")[0] ?? tag;
    if (RTL_LOCALES.has(base)) dir[tag] = "rtl";
  }
  return dir;
}

/**
 * Format the `i18n: { … }` block for `oke.config.ts`.
 *
 * @param locales - Full locale list
 */
export function formatI18nConfig(locales: readonly string[]): string {
  const list = locales.map((l) => JSON.stringify(l)).join(", ");
  const dir = dirMapForLocales(locales);
  const dirKeys = Object.keys(dir);
  if (dirKeys.length === 0) {
    return `i18n: { locales: [${list}], default: "en" }`;
  }
  const dirBody = dirKeys.map((k) => `${JSON.stringify(k)}: "rtl"`).join(", ");
  return `i18n: { locales: [${list}], default: "en", dir: { ${dirBody} } }`;
}

/** Bundled Arabic catalog matching template `src/locales/en.ts` keys. */
export const AR_LOCALE_SOURCE = `import { defineLocale } from "okengine";
import type { MessagesFor } from "okengine";
import type { en } from "./en";

const ar = {
  errors: {
    notFound: "غير موجود",
    unauthorized: "غير مصرح",
  },
  notes: {
    created: "تم إنشاء الملاحظة «{title}».",
    archived: "تم أرشفة الملاحظة.",
    empty: "لا توجد ملاحظات نشطة بعد.",
    count: "{count, plural, zero {لا ملاحظات} one {ملاحظة واحدة} two {ملاحظتان} few {# ملاحظات} many {# ملاحظة} other {# ملاحظة}}",
  },
} satisfies MessagesFor<typeof en>;

defineLocale("ar", ar);
`;

/**
 * Stub locale module — English strings as a translation starting point.
 *
 * @param tag - Locale tag (`fr`, `de`, …)
 */
export function stubLocaleSource(tag: string): string {
  const id = tag.replaceAll("-", "_");
  return `import { defineLocale } from "okengine";
import type { MessagesFor } from "okengine";
import type { en } from "./en";

/** TODO: translate — seeded from English so keys stay aligned. */
const ${id} = {
  errors: {
    notFound: "Not found",
    unauthorized: "Unauthorized",
  },
  notes: {
    created: 'Note "{title}" was created.',
    archived: "Note archived.",
    empty: "No active notes yet.",
    count: "{count, plural, =0 {no notes} one {# note} other {# notes}}",
  },
} satisfies MessagesFor<typeof en>;

defineLocale(${JSON.stringify(tag)}, ${id});
`;
}

/**
 * Resolve source for a locale tag (bundled seed or English stub).
 *
 * @param tag - Normalized locale tag
 */
export function localeFileSource(tag: string): string {
  if (tag === "ar") return AR_LOCALE_SOURCE;
  return stubLocaleSource(tag);
}

/**
 * Apply extra locales onto a scaffolded project (English-only templates).
 *
 * When `extra` is empty: ensure English-only config / channels / locale index
 * and remove leftover `src/locales/<tag>.ts` files other than `en.ts` /
 * `index.ts`.
 *
 * @param targetDir - Project root
 * @param extra - Extra locale tags (not including `en`)
 * @returns Relative paths written or removed (POSIX)
 */
export function applyLocalesToProject(
  targetDir: string,
  extra: readonly string[] = [],
): readonly string[] {
  const extras = parseExtraLocales(extra.join(",")) ?? [];
  const locales = localesWithDefault(extras);
  const touched: string[] = [];

  const configPath = join(targetDir, "oke.config.ts");
  if (existsSync(configPath)) {
    const source = readFileSync(configPath, "utf8");
    const next = replaceI18nConfig(source, locales);
    if (next !== source) {
      writeFileSync(configPath, next, "utf8");
      touched.push("oke.config.ts");
    }
  }

  const list = locales.map((l) => JSON.stringify(l)).join(", ");
  const channelCandidates = ["src/core.ts", "src/core/channels.ts"] as const;
  for (const rel of channelCandidates) {
    const channelsPath = join(targetDir, rel);
    if (!existsSync(channelsPath)) continue;
    const source = readFileSync(channelsPath, "utf8");
    const next = source.replace(/locales:\s*\[[^\]]*\]/, `locales: [${list}]`);
    if (next !== source) {
      writeFileSync(channelsPath, next, "utf8");
      touched.push(rel);
    }
    break;
  }

  const localesDir = join(targetDir, "src/locales");
  mkdirSync(localesDir, { recursive: true });

  // Remove non-English locale modules that are no longer selected.
  try {
    for (const entry of readdirSync(localesDir)) {
      if (!entry.endsWith(".ts") || entry === "en.ts" || entry === "index.ts") continue;
      const tag = entry.slice(0, -".ts".length);
      if (!extras.includes(tag)) {
        unlinkSync(join(localesDir, entry));
        touched.push(`src/locales/${entry}`);
      }
    }
  } catch {
    // locales dir may be absent in stubs
  }

  for (const tag of extras) {
    const rel = `src/locales/${tag}.ts`;
    writeFileSync(join(targetDir, rel), localeFileSource(tag), "utf8");
    if (!touched.includes(rel)) touched.push(rel);
  }

  const indexPath = join(localesDir, "index.ts");
  const indexSource = formatLocalesIndex(locales);
  const prevIndex = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
  if (prevIndex !== indexSource) {
    writeFileSync(indexPath, indexSource, "utf8");
    if (!touched.includes("src/locales/index.ts")) touched.push("src/locales/index.ts");
  }

  // Strip legacy per-locale imports from app.ts (locales load via core → index).
  const appPath = join(targetDir, "src/app.ts");
  if (existsSync(appPath)) {
    const source = readFileSync(appPath, "utf8");
    const next = stripLegacyAppLocaleImports(source);
    if (next !== source) {
      writeFileSync(appPath, next, "utf8");
      touched.push("src/app.ts");
    }
  }

  return touched;
}

/**
 * Replace or insert the `i18n:` config line.
 *
 * @param source - `oke.config.ts` source
 * @param locales - Full locale list
 */
export function replaceI18nConfig(source: string, locales: readonly string[]): string {
  const block = formatI18nConfig(locales);
  const start = source.search(/i18n:\s*\{/);
  if (start < 0) {
    // Insert before the closing `});` of defineConfig.
    return source.replace(/\n\}\);\s*$/, `,\n  ${block},\n});\n`);
  }
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return `${source.slice(0, start)}${block}${source.slice(end)}`;
}

/**
 * Build `src/locales/index.ts` that side-effect-imports every catalog.
 *
 * @param locales - Full locale list (`en` first)
 */
export function formatLocalesIndex(locales: readonly string[]): string {
  const imports = locales.map((l) => `import "./${l}";`).join("\n");
  return `/**
 * Message catalogs — imported once from \`src/core.ts\`.
 * Add a sibling import when you add a locale file.
 */

${imports}
`;
}

/**
 * Remove legacy `@/locales/<tag>` / `./locales/<tag>` imports from `app.ts`.
 *
 * @param source - `src/app.ts` source
 */
export function stripLegacyAppLocaleImports(source: string): string {
  return source.replace(/^import\s+["'](?:@\/|\.\/)locales\/[^"']+["'];\s*\n/gm, "");
}

/**
 * @deprecated Prefer {@link formatLocalesIndex} — kept for older tests/callers.
 * Rewrite `@/locales/<tag>` imports on `app.ts` (legacy side-effect style).
 *
 * @param source - `src/app.ts` source
 * @param locales - Full locale list
 */
export function rewriteAppLocaleImports(source: string, locales: readonly string[]): string {
  const withoutLocaleImports = stripLegacyAppLocaleImports(source);
  const imports = locales.map((l) => `import "@/locales/${l}";`).join("\n");
  const m = /^(import\s+.+;\n)/m.exec(withoutLocaleImports);
  if (!m) {
    return `${imports}\n${withoutLocaleImports}`;
  }
  const idx = m.index + m[0].length;
  return withoutLocaleImports.slice(0, idx) + `${imports}\n` + withoutLocaleImports.slice(idx);
}
