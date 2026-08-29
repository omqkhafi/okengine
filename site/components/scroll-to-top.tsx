"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Resets the window scroll position to the top on client-side route transitions.
 *
 * Next.js App Router preserves the scroll position across navigation when
 * pages share a persistent layout (e.g. within `/docs` or across site tabs).
 * This component listens for pathname changes and scrolls the window back to
 * the top (or to the targeted hash fragment if one is specified in the URL).
 */
export function ScrollToTop() {
  const pathname = usePathname();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const hash = window.location.hash.slice(1);
    if (hash) {
      const decodedHash = decodeURIComponent(hash);
      const target = document.getElementById(decodedHash);
      if (target) {
        target.scrollIntoView();
        return;
      }

      const frameId = requestAnimationFrame(() => {
        const deferredTarget = document.getElementById(decodedHash);
        if (deferredTarget) {
          deferredTarget.scrollIntoView();
        } else {
          window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        }
      });
      return () => cancelAnimationFrame(frameId);
    }

    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

  return null;
}
