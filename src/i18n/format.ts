/**
 * ICU MessageFormat formatting via FormatJS (`intl-messageformat`).
 *
 * Supports interpolation, cardinal/ordinal plurals, `select` / `selectordinal`,
 * and rich-text tags (`<tag>…</tag>` with function values).
 */

import IntlMessageFormat from "intl-messageformat";
import type { MessageValues } from "./types.ts";

const cache = new Map<string, IntlMessageFormat>();

/**
 * Clear the compiled-message cache (tests only).
 */
export function clearMessageFormatCache(): void {
  cache.clear();
}

/**
 * Format an ICU message for a locale.
 *
 * @param message - ICU MessageFormat source
 * @param locale - BCP 47 locale tag
 * @param values - Interpolation / plural / select / rich-text values
 */
export function formatMessage(message: string, locale: string, values?: MessageValues): string {
  const cacheKey = `${locale}\0${message}`;
  let formatter = cache.get(cacheKey);
  if (!formatter) {
    try {
      formatter = new IntlMessageFormat(message, locale);
    } catch {
      // Malformed ICU — treat as a plain template.
      return message;
    }
    cache.set(cacheKey, formatter);
  }

  try {
    const result = formatter.format(values as Record<string, unknown> | undefined);
    return partsToString(result);
  } catch {
    // Missing args — leave the source for callers that fall back.
    return message;
  }
}

/**
 * Collapse FormatJS rich-text / string output to a single string.
 *
 * @param result - `format()` return value
 */
function partsToString(result: unknown): string {
  if (typeof result === "string") return result;
  if (typeof result === "number" || typeof result === "boolean") return String(result);
  if (Array.isArray(result)) {
    return result
      .map((part) => {
        if (typeof part === "string" || typeof part === "number") return String(part);
        return "";
      })
      .join("");
  }
  if (result == null) return "";
  return String(result);
}
