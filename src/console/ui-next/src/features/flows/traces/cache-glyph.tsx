/**
 * Shared traces cache mark — hit / miss / none.
 */

import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { cacheIconSpec, type RunCache } from "./cache-icon.ts";

/** Props for {@link CacheGlyph}. */
export interface CacheGlyphProps {
  readonly cache: RunCache;
  readonly dataSlot: string;
}

/**
 * Same flash / flash-off / unavailable mark as a Traces row.
 *
 * @param props - Cache dimension + data-slot
 */
export function CacheGlyph({ cache, dataSlot }: CacheGlyphProps): JSX.Element {
  const spec = cacheIconSpec(cache);
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span
            {...props}
            className={cn("flex w-4 shrink-0 items-center justify-center", spec.className)}
            data-slot={dataSlot}
            data-cache={cache}
            aria-label={spec.label}
          >
            <HugeiconsIcon icon={spec.icon} className="size-3" aria-hidden />
          </span>
        )}
      />
      <TooltipContent side="top">{spec.label}</TooltipContent>
    </Tooltip>
  );
}
