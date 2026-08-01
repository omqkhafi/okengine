/**
 * Request-scoped locale for {@link fail} / {@link OkeError} localization.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Active locale bag for the current async context. */
export interface LocaleContext {
  readonly locale: string;
  readonly defaultLocale: string;
}

const storage = new AsyncLocalStorage<LocaleContext>();

/**
 * Run `fn` with an active locale context (request / invocation scope).
 *
 * @param ctx - Locale + default
 * @param fn - Work to run
 */
export function runWithLocale<T>(ctx: LocaleContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Active locale context, if any.
 */
export function getLocaleContext(): LocaleContext | undefined {
  return storage.getStore();
}

/**
 * Active locale, or `fallback` when none is set.
 *
 * @param fallback - Default when outside a request (default `"en"`)
 */
export function getActiveLocale(fallback = "en"): string {
  return storage.getStore()?.locale ?? fallback;
}

/**
 * Active default locale for catalog fallback.
 *
 * @param fallback - Default when outside a request (default `"en"`)
 */
export function getActiveDefaultLocale(fallback = "en"): string {
  return storage.getStore()?.defaultLocale ?? fallback;
}
