/**
 * Locale chain display + RTL dir (console §9.9).
 */

/**
 * Format locale resolution chain for display.
 *
 * @param chain - Resolution steps
 */
export function formatLocaleChainDisplay(
  chain: readonly string[],
): string {
  if (chain.length === 0) return "default";
  return chain.join(" → ");
}

/**
 * Document direction for a locale tag.
 *
 * @param locale - BCP 47 locale
 */
export function dirForLocale(locale: string): "ltr" | "rtl" {
  const base = locale.toLowerCase().split("-")[0] ?? locale;
  return base === "ar" ||
    base === "he" ||
    base === "fa" ||
    base === "ur" ||
    base === "yi"
    ? "rtl"
    : "ltr";
}
