/**
 * Canonical public docs origin for scaffolded AGENTS.md and next-steps.
 *
 * Keep in lockstep with `src/docs-origin.ts` in the okengine package.
 */

/** Live docs site. */
export const DOCS_ORIGIN = "https://oke.omqkhafi.dev" as const;

/**
 * Absolute docs URL for a path under the handbook / site.
 *
 * @param path - Path beginning with `/` (e.g. `/docs`)
 */
export function docsUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${DOCS_ORIGIN}${normalized}`;
}
