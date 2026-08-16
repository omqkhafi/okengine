/**
 * Console document title + description — keep in sync with `index.html`.
 */

/** Default browser tab title and `og:title`. */
export const CONSOLE_DOCUMENT_TITLE = "okengine Console";

/** Operator-facing `meta name="description"` / Open Graph copy. */
export const CONSOLE_DOCUMENT_DESCRIPTION =
  "Operator Console for okengine — Flows, Store, Observability, and Vault.";

const PAGE_TITLES: Record<string, string> = {
  "/overview": "Overview",
  "/flows": "Flows",
  "/store": "Store",
  "/observability": "Observability",
  "/vault": "Vault",
  "/monitoring": "Observability",
};

/**
 * Tab title for a Console pathname.
 *
 * Gate (`/`) uses the default. Known modules prefix the page name.
 * Anything else is treated as not found.
 *
 * @param pathname - Location pathname
 */
export function consoleDocumentTitle(pathname: string): string {
  if (pathname === "/" || pathname === "") return CONSOLE_DOCUMENT_TITLE;
  const page = PAGE_TITLES[pathname];
  if (page) return `${page} · ${CONSOLE_DOCUMENT_TITLE}`;
  return `Not found · ${CONSOLE_DOCUMENT_TITLE}`;
}
