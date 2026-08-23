/**
 * Machine-readable 404 body — the HTML not-found view is for browsers;
 * agents that send `Accept: text/markdown` get this instead.
 */

import { markdownResponse } from "./markdown-response";

/**
 * Markdown 404 pointing at the three real navigation aids on this origin.
 * Status language matches the HTML not-found surface (OKE0404), not new copy.
 */
export function markdownNotFoundBody(): string {
  return `# Not found

OKE0404 · flow.not_found

No Flow matched this path.

- [Documentation](/docs)
- [llms.txt](/llms.txt)
- [sitemap.xml](/sitemap.xml)
`;
}

/**
 * 404 markdown Response with `Content-Type: text/markdown` and `Vary: Accept`.
 */
export function markdownNotFoundResponse(): Response {
  return markdownResponse(markdownNotFoundBody(), 404);
}
