import { type ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Loading placeholder block (shadcn Skeleton).
 *
 * @param props - Standard div props
 */
function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
