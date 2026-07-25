'use client';

import { useSyncExternalStore } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * Subscribe to the OS prefers-reduced-motion media query.
 *
 * @param onChange - Listener invoked when the preference flips
 */
function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * Prefer-reduced-motion, safe for SSR hydration.
 *
 * Reads `matchMedia` through `useSyncExternalStore` with a `false` server
 * snapshot so the first client render matches the HTML. Avoids Framer Motion's
 * `useReducedMotion` / `reducedMotion="user"`, which refuse transform animates
 * and log a development warning when the OS preference is on — callers gate
 * motion themselves and keep `MotionConfig` at `never`.
 */
export function useClientReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}
