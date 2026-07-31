/**
 * Shared response-header mutation for HTTP middleware plugins.
 * Web `Headers` are immutable-in-place on a built `Response` — rebuild instead.
 */

/**
 * Rebuild a response with headers mutated by `fn`.
 *
 * @param response - Original response
 * @param fn - Header mutation
 */
export function withHeaders(response: Response, fn: (headers: Headers) => void): Response {
  const headers = new Headers(response.headers);
  fn(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Set a header only when absent (or when `override` is on).
 *
 * @param headers - Mutable headers
 * @param name - Header name
 * @param value - Header value
 * @param override - Replace an app-set value
 */
export function setUnlessPresent(
  headers: Headers,
  name: string,
  value: string,
  override: boolean,
): void {
  if (!override && headers.has(name)) return;
  headers.set(name, value);
}

/**
 * Append a token to `Vary` without duplicating it.
 *
 * @param headers - Mutable headers
 * @param token - Vary token (e.g. `"origin"`)
 */
export function appendVary(headers: Headers, token: string): void {
  const vary = headers.get("vary");
  if (vary === null) {
    headers.set("vary", token);
    return;
  }
  const pattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (!pattern.test(vary)) headers.set("vary", `${vary}, ${token}`);
}
