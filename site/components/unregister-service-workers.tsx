"use client";

import { useEffect } from "react";

/**
 * Drop leftover service workers for this origin.
 *
 * A prior `/sw.js` registration (often from another app on localhost:3000)
 * keeps requesting the script on every navigation.
 */
export function UnregisterServiceWorkers() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const reg of regs) void reg.unregister();
    });
  }, []);
  return null;
}
