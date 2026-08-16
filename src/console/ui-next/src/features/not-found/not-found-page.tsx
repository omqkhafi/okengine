/**
 * Unknown Console path — stay on the typed URL. No rewrite, no bounce.
 */

import { authLabelClassName } from "@/components/auth-card";
import { ConsoleChrome } from "@/components/console-chrome";

/**
 * 404 for any path that is not `/`, `/overview`, `/flows`, `/store`, `/vault`, or `/observability`.
 */
export function NotFoundPage() {
  return (
    <ConsoleChrome>
      <div data-slot="not-found">
        <p className={authLabelClassName}>404</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This URL is not a Console page.
        </p>
      </div>
    </ConsoleChrome>
  );
}
