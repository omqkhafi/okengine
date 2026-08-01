/**
 * Resolve a localized `error.message` for typed flow failures.
 */

import { getActiveDefaultLocale, getActiveLocale } from "./locale-context.ts";
import { getMessageCatalogs, translate } from "./messages.ts";
import type { MessageValues } from "./types.ts";

/**
 * Whether a reason string is safe as a catalog key segment.
 *
 * @param reason - Failure `data.reason`
 */
export function isCatalogReason(reason: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(reason);
}

/**
 * Normalize a free-text reason into a catalog key segment.
 *
 * @param reason - Raw reason
 */
export function catalogReasonKey(reason: string): string {
  if (isCatalogReason(reason)) return reason;
  return reason
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Build ICU values from failure data (string/number/boolean leaves only).
 *
 * @param data - Failure payload
 */
export function failureMessageValues(data: unknown): MessageValues | undefined {
  if (data === null || data === undefined || typeof data !== "object") return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Resolve a localized message for a typed failure, or `undefined` when no
 * built-in / app catalog entry exists (custom app codes stay message-less).
 *
 * Lookup order: `errors.{code}.{reason}` → `errors.{code}`.
 *
 * @param code - Failure code (`AuthFailed`, `Unauthorized`, …)
 * @param data - Failure data (may include `reason`)
 * @param locale - Override locale (defaults to active request locale)
 */
export function resolveFailureMessage(
  code: string,
  data?: unknown,
  locale?: string,
): string | undefined {
  const catalogs = getMessageCatalogs();
  const activeLocale = locale ?? getActiveLocale("en");
  const defaultLocale = getActiveDefaultLocale("en");
  const values = failureMessageValues(data);
  const reason =
    data !== null &&
    data !== undefined &&
    typeof data === "object" &&
    "reason" in data &&
    typeof (data as { reason: unknown }).reason === "string"
      ? catalogReasonKey((data as { reason: string }).reason)
      : undefined;

  const keys: string[] = [];
  if (reason) keys.push(`errors.${code}.${reason}`);
  keys.push(`errors.${code}`);

  for (const key of keys) {
    const primary = catalogs[activeLocale]?.[key];
    const fallback = catalogs[defaultLocale]?.[key];
    if (primary === undefined && fallback === undefined) continue;
    return translate({
      locale: activeLocale,
      defaultLocale,
      catalogs,
      key,
      values,
    });
  }
  return undefined;
}
