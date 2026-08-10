/**
 * Class-name helper for shadcn/ui components.
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names with conflict resolution.
 *
 * @param inputs - Class value list
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
