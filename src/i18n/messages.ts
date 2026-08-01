/**
 * App message catalogs for {@link Fx.t}.
 *
 * Locales register via {@link defineLocale}; boot wires catalogs into `fx`
 * with the active request locale and the `i18n.default` fallback from
 * `oke.config.ts`. Messages use ICU MessageFormat syntax.
 *
 * Built-in EN/AR catalogs (framework OKE codes + typed failures) are always
 * present; app keys override built-ins for the same locale/key.
 */

import { builtinAr } from "./catalogs/ar.ts";
import { builtinEn } from "./catalogs/en.ts";
import { formatMessage } from "./format.ts";
import type { MessageTree, MessageValues } from "./types.ts";

export type { MessageTree, MessageValues } from "./types.ts";

/** Flat key → message map after {@link flattenMessages}. */
export type MessageCatalog = Readonly<Record<string, string>>;

/** All registered locale catalogs (locale → flat map). */
export type MessageCatalogs = Readonly<Record<string, MessageCatalog>>;

/**
 * Flatten a nested message tree into dot-separated keys.
 *
 * @param tree - Nested or flat messages
 * @param prefix - Key prefix for recursion
 */
export function flattenMessages(tree: MessageTree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out[path] = value;
    } else {
      Object.assign(out, flattenMessages(value, path));
    }
  }
  return out;
}

/** App-registered overlays (win over built-ins per key). */
const registry = new Map<string, Record<string, string>>();

/** Built-in EN/AR catalogs (framework + typed failures). */
const builtins: Readonly<Record<string, MessageCatalog>> = {
  en: flattenMessages(builtinEn as unknown as MessageTree),
  ar: flattenMessages(builtinAr as unknown as MessageTree),
};

/**
 * Identity helper that preserves a `const` message tree for typing.
 *
 * @param messages - Canonical catalog (usually English)
 */
export function defineMessages<const T extends MessageTree>(messages: T): T {
  return messages;
}

/**
 * Register (or replace) messages for a locale.
 *
 * Side-effect import from `src/locales/<locale>.ts` before boot.
 * Prefer `as const` / {@link defineMessages} on the default locale, then
 * `satisfies MessagesFor<typeof en>` on translations so keys stay aligned.
 *
 * @param locale - BCP 47 locale tag (e.g. `"en"`, `"ar"`)
 * @param messages - Nested or flat ICU message tree
 */
export function defineLocale<const T extends MessageTree>(locale: string, messages: T): T {
  const tag = locale.trim();
  if (!tag) throw new Error("defineLocale: locale must be non-empty");
  registry.set(tag, flattenMessages(messages));
  return messages;
}

/**
 * Snapshot of every catalog — built-ins merged under app overlays.
 */
export function getMessageCatalogs(): MessageCatalogs {
  const locales = new Set([...Object.keys(builtins), ...registry.keys()]);
  const out: Record<string, MessageCatalog> = {};
  for (const locale of locales) {
    out[locale] = { ...(builtins[locale] ?? {}), ...(registry.get(locale) ?? {}) };
  }
  return out;
}

/**
 * Clear app-registered catalogs (tests only). Built-ins remain.
 */
export function clearMessageCatalogs(): void {
  registry.clear();
}

/**
 * @deprecated Use ICU `{name}` via {@link formatMessage} / `fx.t`. Kept for
 * channel-style `{{name}}` callers during migration; not used by `fx.t`.
 *
 * @param template - Message template
 * @param params - Replacement values
 */
export function interpolateMessage(
  template: string,
  params?: Readonly<Record<string, unknown>>,
): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? `{{${name}}}` : String(value);
  });
}

/** Options for {@link translate}. */
export interface TranslateOptions {
  readonly locale: string;
  readonly defaultLocale: string;
  readonly catalogs: MessageCatalogs;
  readonly key: string;
  readonly values?: MessageValues;
  /** @deprecated Prefer {@link TranslateOptions.values}. */
  readonly params?: MessageValues;
}

/**
 * Resolve a message key through locale → default → key fallback, then format
 * with ICU MessageFormat.
 *
 * @param options - Locale, catalogs, key, values
 */
export function translate(options: TranslateOptions): string {
  const { locale, defaultLocale, catalogs, key } = options;
  const values = options.values ?? options.params;
  const primary = catalogs[locale]?.[key];
  if (primary !== undefined) return formatMessage(primary, locale, values);
  if (locale !== defaultLocale) {
    const fallback = catalogs[defaultLocale]?.[key];
    if (fallback !== undefined) return formatMessage(fallback, defaultLocale, values);
  }
  if (values === undefined) return key;
  return `${key}:${JSON.stringify(values)}`;
}

/**
 * Pick the best catalog locale from a candidate against configured locales.
 *
 * Exact match, then language subtag (`ar-SA` → `ar`), then default.
 *
 * @param candidate - Requested locale (may be undefined)
 * @param locales - Configured locales
 * @param defaultLocale - Fallback locale
 */
export function matchConfiguredLocale(
  candidate: string | undefined,
  locales: readonly string[],
  defaultLocale: string,
): string {
  if (!candidate?.trim()) return defaultLocale;
  const tag = candidate.trim();
  if (locales.includes(tag)) return tag;
  const base = tag.toLowerCase().split("-")[0] ?? tag;
  const byBase = locales.find(
    (l) => l.toLowerCase() === base || l.toLowerCase().startsWith(`${base}-`),
  );
  if (byBase) return byBase;
  return defaultLocale;
}
