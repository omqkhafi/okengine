/**
 * Best-effort `fetch.preconnect` for AI HTTP drivers.
 *
 * Bun throws `Invalid port` when the URL uses an implicit 80/443. A failed
 * preconnect must not fail the request and must not log.
 *
 * @param fetchFn - Injected or global fetch
 * @param url - Origin or base URL to warm
 */
export function preconnectFetch(fetchFn: typeof fetch, url: string): void {
  const preconnect = (fetchFn as { preconnect?: (href: string) => void }).preconnect;
  if (typeof preconnect !== "function") return;
  try {
    preconnect(url);
  } catch {
    // Bun rejects default ports. The request still runs.
  }
}
