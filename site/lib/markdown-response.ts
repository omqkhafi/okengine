/**
 * Markdown HTTP responses for negotiated (and rewrite-target) routes.
 * `Vary: Accept` is mandatory: the same URL has an HTML twin selected by Accept.
 */

/** Content-Type for every markdown body this site serves. */
export const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

/** Cache-key token for Accept negotiation. */
export const VARY_ACCEPT = "Accept";

/**
 * Headers for a markdown representation selected (or selectable) by Accept.
 */
export function markdownHeaders(): HeadersInit {
  return {
    "Content-Type": MARKDOWN_CONTENT_TYPE,
    Vary: VARY_ACCEPT,
  };
}

/**
 * Build a markdown Response, defaulting to 200.
 *
 * @param body - Markdown text
 * @param status - HTTP status (404 for the not-found body)
 */
export function markdownResponse(body: string, status: number = 200): Response {
  return new Response(body, {
    status,
    headers: markdownHeaders(),
  });
}
