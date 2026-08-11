/**
 * HTTP method badge — shared Traces / Units chrome.
 */

import type { JSX } from "react";
import { Badge } from "@/components/ui/badge";
import { httpMethodBadgeClass } from "@/features/flows/traces/http-method.ts";
import { cn } from "@/lib/utils";

/** Props for {@link HttpMethodBadge}. */
export interface HttpMethodBadgeProps {
  readonly method: string;
  readonly className?: string;
}

/**
 * Outline badge colored by HTTP method.
 *
 * @param props - Method string
 */
export function HttpMethodBadge({ method, className }: HttpMethodBadgeProps): JSX.Element {
  return (
    <Badge
      variant="outline"
      className={cn("h-5 px-1.5 font-mono text-[10px] uppercase", httpMethodBadgeClass(method), className)}
      data-slot="http-method-badge"
    >
      {method}
    </Badge>
  );
}
