/**
 * Chrome / Cursor DevTools probe HTTP origins as Chrome DevTools Protocol
 * endpoints (`GET /json/version`, `GET /json/list`, `GET /json`).
 */

/**
 * True when this request is a CDP discovery probe, not a handbook URL.
 *
 * @param method - HTTP method
 * @param pathname - URL pathname (query stripped)
 */
export function isChromeInspectorProbe(method: string, pathname: string): boolean {
  const verb = method.toUpperCase();
  if (verb !== "GET" && verb !== "HEAD") return false;
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return path === "/json" || path.startsWith("/json/");
}
