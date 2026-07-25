/**
 * Canonical public docs origin for scaffolded AGENTS.md and next-steps.
 *
 * Keep in lockstep with `src/docs-origin.ts` in the okengine package.
 * Flip both when the custom domain is attached: `https://oke.omqkhafi.dev`.
 */

/** Live docs site (Vercel). Planned cutover: `https://oke.omqkhafi.dev`. */
export const DOCS_ORIGIN = "https://okengine.vercel.app" as const;

/**
 * Absolute docs URL for a path under the handbook / site.
 *
 * @param path - Path beginning with `/` (e.g. `/docs`)
 */
export function docsUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${DOCS_ORIGIN}${normalized}`;
}
