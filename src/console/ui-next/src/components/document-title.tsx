/**
 * Syncs `document.title` to the current Console route.
 */

import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { consoleDocumentTitle } from "@/lib/document-meta.ts";

/**
 * Sets the browser tab title from the location pathname.
 */
export function DocumentTitle() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    document.title = consoleDocumentTitle(pathname);
  }, [pathname]);
  return null;
}
