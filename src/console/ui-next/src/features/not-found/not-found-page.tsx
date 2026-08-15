/**
 * Unknown Console path — stay on the typed URL. No rewrite, no bounce.
 */

import { ConsoleChrome } from "@/components/console-chrome";

/**
 * 404 for any path that is not `/`, `/overview`, `/flows`, `/store`, or `/vault`.
 */
export function NotFoundPage() {
  return (
    <ConsoleChrome>
      <div className="text-center" data-slot="not-found">
        <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground">404</p>
        <h1 className="mt-2 text-lg font-medium">Page not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">This URL is not a Console page.</p>
      </div>
    </ConsoleChrome>
  );
}
