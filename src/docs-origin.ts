/**
 * Canonical public docs origin for error links, README, and the site.
 *
 * Keep in lockstep with `packages/create-oke/src/docs-origin.ts` and
 * `site/app/layout.tsx` (`metadataBase`).
 */

/** Live docs site. */
export const DOCS_ORIGIN = "https://oke.omqkhafi.dev" as const;

/**
 * Absolute docs URL for a path under the handbook / site.
 *
 * @param path - Path beginning with `/` (e.g. `/docs`, `/e/1001`)
 */
export function docsUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${DOCS_ORIGIN}${normalized}`;
}
