/**
 * Borderless explorer search — same field on Units, Store, Vault, and Traces.
 */

import type { ComponentProps, JSX } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils.ts";
import { EXPLORER_SEARCH_CLASS } from "./explorer-chrome.ts";

/**
 * Flush search input for an explorer toolbar.
 *
 * @param props - Native input props (`flat` is always on)
 */
export function ExplorerSearch({
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "flat">): JSX.Element {
  return <Input flat className={cn(EXPLORER_SEARCH_CLASS, className)} {...props} />;
}
