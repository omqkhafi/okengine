/**
 * Shared explorer chrome — Overview / Flows / Store / Vault speak one layout language.
 */

/** Full-bleed page shell — same `svh` box as `ShellLayout` so mobile chrome cannot clip. */
export const EXPLORER_PAGE_CLASS = "flex h-svh max-h-svh flex-col overflow-hidden";

/** Left explorer / right inspector split (Flows · Store · Vault · Overview). */
export const EXPLORER_SPLIT = {
  start: { defaultSize: "28%", minSize: "18%" },
  end: { defaultSize: "72%", minSize: "40%" },
} as const;

/** Flush search field inside {@link EXPLORER_TOOLBAR_CLASS}. */
export const EXPLORER_SEARCH_CLASS =
  "h-8 min-w-0 flex-1 rounded-none border-0 bg-transparent px-2 text-xs shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent";

/** Search + icon-action row at the top of every left pane. */
export const EXPLORER_TOOLBAR_CLASS =
  "flex h-8 shrink-0 items-center gap-1 border-b border-border/60";

/** Bordered 24px toolbar control (expand, visibility, verify). */
export const EXPLORER_ICON_BUTTON_CLASS =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40";

/** Icon-only control on a band / folder row (no chrome). */
export const EXPLORER_ICON_BUTTON_BARE_CLASS =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40";

/** Facet / trigger / kind band — flush, no fill (Traces language). */
export const EXPLORER_BAND_CLASS = "overflow-hidden border-b border-border/60 last:border-b-0";

/** Band header row. */
export const EXPLORER_BAND_HEADER_CLASS =
  "group/band flex w-full items-center gap-2 border-b border-border/60 px-2 py-1.5 text-left transition-colors hover:bg-muted/50";

/** Uppercase band title. */
export const EXPLORER_BAND_LABEL_CLASS =
  "min-w-0 truncate text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase group-hover/band:text-foreground";

/** Count — tabular nums, no chip. */
export const EXPLORER_COUNT_CLASS =
  "shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground";

/** Selectable leaf row — same density as a TraceRow. */
export const EXPLORER_ROW_CLASS =
  "group relative flex w-full items-center gap-2 border-b border-border/60 py-1.5 pr-2 pl-2.5 text-left text-xs transition-colors hover:bg-muted/50";

/** Selected leaf fill. */
export const EXPLORER_ROW_SELECTED_CLASS = "bg-muted/70 text-foreground";

/** Left selection rail — full-height, traces. */
export const EXPLORER_RAIL_CLASS = "absolute inset-y-0 left-0 w-0.5 transition-colors";

/** Default selection rail ink — Overview / Flows / Store. */
export const EXPLORER_RAIL_ACTIVE_CLASS = "bg-sky-500";

/** Folder / group row (same density as a leaf). */
export const EXPLORER_GROUP_ROW_CLASS =
  "group/folder flex w-full items-center gap-2 border-b border-border/60 px-2 py-1.5 text-left transition-colors hover:bg-muted/50";

/** Bare chevron on a band or folder. */
export const EXPLORER_CHEVRON_CLASS = "size-3 shrink-0 text-muted-foreground transition-transform";

/** Bare icon (no well) — traces. */
export const EXPLORER_ICON_CLASS = "size-3.5 shrink-0";

/** Hover-reveal actions on a band header. */
export const EXPLORER_BAND_ACTIONS_CLASS =
  "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/band:opacity-100 group-focus-within/band:opacity-100";

/** Size-5 tinted icon well — detail headers / posture marks. */
export const EXPLORER_WELL_CLASS =
  "flex size-5 shrink-0 items-center justify-center rounded-md border";

/** Folder well (neutral) — kept for callers that still box a folder. */
export const EXPLORER_FOLDER_WELL_CLASS =
  "flex size-5 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground transition-colors";

/**
 * Keep only text-tint classes from a well spec so a bare icon can reuse it.
 *
 * @param wellClass - Border / fill / text well classes
 */
export function explorerIconInk(wellClass: string): string {
  return wellClass
    .split(/\s+/)
    .filter((token) => token.startsWith("text-") || token.startsWith("dark:text-"))
    .join(" ");
}

/** Inspector identity header. */
export const DETAIL_HEADER_CLASS =
  "flex shrink-0 items-center gap-3 border-b border-border/60 bg-background/95 px-3 py-2 backdrop-blur-sm";

/** Size-8 rounded-lg well in a detail header. */
export const DETAIL_WELL_CLASS =
  "flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70";

/** Detail title. */
export const DETAIL_TITLE_CLASS =
  "min-w-0 truncate text-sm font-semibold tracking-tight text-foreground";

/** Uppercase section eyebrow. */
export const SECTION_HEAD_CLASS =
  "text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase";

/** Compact empty copy inside a left explorer (too narrow for the Empty primitive). */
export const EXPLORER_LIST_EMPTY_CLASS = "px-2 py-4 text-sm text-muted-foreground";
