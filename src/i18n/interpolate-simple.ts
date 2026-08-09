/**
 * Zero-dependency message interpolation for the cold path.
 *
 * Handles plain strings and simple `{name}` placeholders. ICU plural /
 * select / rich-text go through {@link formatMessage} (FormatJS) when needed.
 */

import type { MessageValues } from "./types.ts";

/** True when the template needs ICU MessageFormat (plural/select/rich tags). */
export function needsIcuFormat(message: string): boolean {
  // plural/select: `{count, plural, …}` or `{gender, select, …}`
  if (/\{[^{}]+,\s*(?:plural|select|selectordinal)\b/.test(message)) return true;
  // rich-text tags: `<tag>…</tag>` or self-closing
  if (/<\/?[A-Za-z][\w-]*/.test(message)) return true;
  // number/date skeleton: `{n, number}` / `{d, date}`
  if (/\{[^{}]+,\s*(?:number|date|time)\b/.test(message)) return true;
  return false;
}

/**
 * Replace simple `{name}` placeholders without FormatJS.
 *
 * @param message - Template
 * @param values - Interpolation values
 */
export function interpolateSimple(message: string, values?: MessageValues): string {
  // Catalogs use ICU apostrophe escaping (`''` → `'`) even on the simple path.
  const base = message.replaceAll("''", "'");
  if (!values) return base;
  return base.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name];
    if (value === undefined || value === null) return match;
    if (typeof value === "function") return match;
    return String(value);
  });
}
