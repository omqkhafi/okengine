/**
 * Locale resolution chain — profile → Accept-Language → default (console §9.9).
 */

/** One step in the locale resolution chain. */
export type LocaleChainStep =
  | `profile:${string}`
  | `accept-language:${string}`
  | `default:${string}`;

/** Result of {@link resolveLocale}. */
export interface LocaleResolution {
  readonly locale: string;
  readonly chain: readonly LocaleChainStep[];
}

/** Inputs for locale resolution. */
export interface ResolveLocaleOptions {
  readonly profileLocale?: string;
  readonly acceptLanguage?: string;
  readonly defaultLocale?: string;
  /** Explicit override (wins; still recorded in the chain when provided). */
  readonly locale?: string;
}

/**
 * Whether a locale is written right-to-left.
 *
 * @param locale - BCP 47 locale tag
 */
export function isRtlLocale(locale: string): boolean {
  const base = locale.toLowerCase().split("-")[0] ?? locale;
  return base === "ar" || base === "he" || base === "fa" || base === "ur" || base === "yi";
}

/**
 * Parse the first language tag from an Accept-Language header.
 *
 * @param header - Raw Accept-Language value
 */
export function parseAcceptLanguage(header: string | undefined): string | undefined {
  if (!header?.trim()) return undefined;
  const first = header.split(",")[0]?.trim();
  if (!first) return undefined;
  const tag = first.split(";")[0]?.trim();
  return tag || undefined;
}

/**
 * Resolve locale with a full chain for the Console to display.
 *
 * Precedence: explicit `locale` → profile → Accept-Language → default.
 *
 * @param options - Resolution inputs
 */
export function resolveLocale(options: ResolveLocaleOptions = {}): LocaleResolution {
  const defaultLocale = options.defaultLocale ?? "en";
  const chain: LocaleChainStep[] = [];

  if (options.locale?.trim()) {
    const locale = options.locale.trim();
    chain.push(`profile:${locale}`);
    return { locale, chain };
  }

  if (options.profileLocale?.trim()) {
    const locale = options.profileLocale.trim();
    chain.push(`profile:${locale}`);
    return { locale, chain };
  }

  const fromHeader = parseAcceptLanguage(options.acceptLanguage);
  if (fromHeader) {
    chain.push(`accept-language:${fromHeader}`);
    return { locale: fromHeader, chain };
  }

  chain.push(`default:${defaultLocale}`);
  return { locale: defaultLocale, chain };
}

/**
 * Format a locale chain for display.
 *
 * @param chain - Resolution steps
 */
export function formatLocaleChain(chain: readonly LocaleChainStep[]): string {
  return chain.join(" → ");
}
