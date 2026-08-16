/**
 * HTTP method accent for the REQUEST section badge.
 */

import {
  Add01Icon,
  ApiIcon,
  Delete02Icon,
  Edit02Icon,
  File01Icon,
  PencilEdit01Icon,
  Search01Icon,
  Settings01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import type { ElementHugeIcon } from "@/lib/element-icons.ts";

/** Known HTTP methods from Manifest `HttpTrigger.method`. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "QUERY";

/**
 * Units-tree display rank: GET → POST → QUERY → PATCH/PUT → DELETE.
 *
 * PATCH and PUT share a rank. Unknown verbs and missing methods sort last.
 *
 * @param method - HTTP method string (case-insensitive) or null for non-HTTP
 */
export function httpMethodSortRank(method: string | null | undefined): number {
  switch ((method ?? "").toUpperCase()) {
    case "GET":
      return 0;
    case "POST":
      return 1;
    case "QUERY":
      return 2;
    case "PUT":
    case "PATCH":
      return 3;
    case "DELETE":
      return 4;
    case "HEAD":
      return 5;
    case "OPTIONS":
      return 6;
    default:
      return method ? 7 : 8;
  }
}

/**
 * CRUD-shaped glyph per HTTP method — Units tree wells.
 *
 * @param method - HTTP method string (case-insensitive)
 */
export function httpMethodIcon(method: string): ElementHugeIcon {
  switch (method.toUpperCase()) {
    case "GET":
      return ViewIcon;
    case "QUERY":
      return Search01Icon;
    case "POST":
      return Add01Icon;
    case "PUT":
      return Edit02Icon;
    case "PATCH":
      return PencilEdit01Icon;
    case "DELETE":
      return Delete02Icon;
    case "HEAD":
      return File01Icon;
    case "OPTIONS":
      return Settings01Icon;
    default:
      return ApiIcon;
  }
}

/**
 * Tailwind classes for a method badge — distinct accents per verb, matching
 * common API-tool convention (GET green, POST blue, PUT amber, PATCH violet,
 * DELETE rose).
 *
 * @param method - HTTP method string (case-insensitive)
 */
export function httpMethodBadgeClass(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "border-emerald-500/35 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "POST":
      return "border-sky-500/35 bg-sky-500/15 text-sky-700 dark:text-sky-400";
    case "PUT":
      return "border-amber-500/35 bg-amber-500/15 text-amber-800 dark:text-amber-400";
    case "PATCH":
      return "border-violet-500/35 bg-violet-500/15 text-violet-700 dark:text-violet-400";
    case "DELETE":
      return "border-rose-500/35 bg-rose-500/15 text-rose-700 dark:text-rose-400";
    case "HEAD":
      return "border-slate-500/35 bg-slate-500/15 text-slate-700 dark:text-slate-300";
    case "OPTIONS":
      return "border-zinc-500/35 bg-zinc-500/15 text-zinc-700 dark:text-zinc-300";
    case "QUERY":
      return "border-emerald-500/35 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

/**
 * Solid rail fill for the Request protocol frame (matches badge accents).
 *
 * @param method - HTTP method string (case-insensitive)
 */
export function httpMethodRailClass(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "bg-emerald-500";
    case "POST":
      return "bg-sky-500";
    case "PUT":
      return "bg-amber-500";
    case "PATCH":
      return "bg-violet-500";
    case "DELETE":
      return "bg-rose-500";
    case "HEAD":
      return "bg-slate-400";
    case "OPTIONS":
      return "bg-zinc-400";
    case "QUERY":
      return "bg-emerald-500";
    default:
      return "bg-muted-foreground";
  }
}
