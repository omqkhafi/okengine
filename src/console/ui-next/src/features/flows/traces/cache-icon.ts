/**
 * Map a run's cache dimension onto a row glyph.
 *
 * `hit` / `miss` share a flash pair; `none` is a quiet not-applicable mark
 * so uncached flows do not look like a miss.
 */

import { FlashIcon, FlashOffIcon, UnavailableIcon } from "@hugeicons/core-free-icons";
import type { RunRow } from "@/client.ts";
import type { ElementHugeIcon } from "@/lib/element-icons.ts";

/** Cache dimension on a projected run. */
export type RunCache = RunRow["cache"];

/** Icon + accessible label + tone for a run's cache status. */
export type CacheIconSpec = {
  readonly icon: ElementHugeIcon;
  readonly label: string;
  readonly className: string;
};

/**
 * Resolve the visual for a WideEvent `cache` value.
 *
 * @param cache - `hit` | `miss` | `none`
 */
export function cacheIconSpec(cache: RunCache): CacheIconSpec {
  switch (cache) {
    case "hit":
      return {
        icon: FlashIcon,
        label: "Cache hit",
        className: "text-sky-500 dark:text-sky-400",
      };
    case "miss":
      return {
        icon: FlashOffIcon,
        label: "Cache miss",
        className: "text-amber-600 dark:text-amber-400",
      };
    case "none":
      return {
        icon: UnavailableIcon,
        label: "Cache not applicable",
        className: "text-muted-foreground/40",
      };
  }
}
