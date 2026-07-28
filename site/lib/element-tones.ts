import { ELEMENTS, type ElementPreviewKind } from "@/lib/elements";

/**
 * Soft chip / wash tone names — one ink per element across the lattice,
 * Features grid, and SVG diagram (`--oke-el-*` in `app/global.css`).
 */
export type ElementChipTone =
  | "sky"
  | "amber"
  | "teal"
  | "orange"
  | "emerald"
  | "yellow"
  | "cyan"
  | "rose";

/**
 * Canonical tone for each element. Lattice washes, Features primary chips, and
 * SVG `--oke-el-*` vars all resolve through this map.
 */
export const ELEMENT_CHIP: Record<ElementPreviewKind, ElementChipTone> = {
  flow: "sky",
  signal: "amber",
  store: "teal",
  clock: "orange",
  gate: "emerald",
  vault: "yellow",
  channel: "cyan",
  ai: "rose",
};

/** Tailwind classes for Features chips and lattice cell washes. */
export const CHIP_TONE: Record<
  ElementChipTone,
  {
    readonly idle: string;
    readonly active: string;
    readonly icon: string;
    readonly wash: string;
    readonly lit: string;
    readonly hairline: string;
    readonly mark: string;
  }
> = {
  sky: {
    idle: "border-sky-500/25 bg-sky-500/[0.06] text-sky-800/80 dark:text-sky-300/80",
    active: "border-sky-500/45 bg-sky-500/15 text-sky-900 dark:text-sky-200",
    icon: "text-sky-600 dark:text-sky-400",
    wash: "bg-sky-500/14 dark:bg-sky-400/16",
    lit: "bg-sky-500/[0.07] dark:bg-sky-400/[0.09]",
    hairline: "bg-sky-500/55 dark:bg-sky-400/50",
    mark: "text-sky-700 dark:text-sky-300",
  },
  amber: {
    idle: "border-amber-500/25 bg-amber-500/[0.06] text-amber-900/80 dark:text-amber-300/80",
    active: "border-amber-500/45 bg-amber-500/15 text-amber-950 dark:text-amber-200",
    icon: "text-amber-600 dark:text-amber-400",
    wash: "bg-amber-500/14 dark:bg-amber-400/16",
    lit: "bg-amber-500/[0.07] dark:bg-amber-400/[0.09]",
    hairline: "bg-amber-500/55 dark:bg-amber-400/50",
    mark: "text-amber-800 dark:text-amber-300",
  },
  teal: {
    idle: "border-teal-500/25 bg-teal-500/[0.06] text-teal-800/80 dark:text-teal-300/80",
    active: "border-teal-500/45 bg-teal-500/15 text-teal-900 dark:text-teal-200",
    icon: "text-teal-600 dark:text-teal-400",
    wash: "bg-teal-500/14 dark:bg-teal-400/16",
    lit: "bg-teal-500/[0.07] dark:bg-teal-400/[0.09]",
    hairline: "bg-teal-500/55 dark:bg-teal-400/50",
    mark: "text-teal-700 dark:text-teal-300",
  },
  orange: {
    idle: "border-orange-500/25 bg-orange-500/[0.06] text-orange-900/80 dark:text-orange-300/80",
    active: "border-orange-500/45 bg-orange-500/15 text-orange-950 dark:text-orange-200",
    icon: "text-orange-600 dark:text-orange-400",
    wash: "bg-orange-500/14 dark:bg-orange-400/16",
    lit: "bg-orange-500/[0.07] dark:bg-orange-400/[0.09]",
    hairline: "bg-orange-500/55 dark:bg-orange-400/50",
    mark: "text-orange-800 dark:text-orange-300",
  },
  emerald: {
    idle: "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-800/80 dark:text-emerald-300/80",
    active: "border-emerald-500/45 bg-emerald-500/15 text-emerald-900 dark:text-emerald-200",
    icon: "text-emerald-600 dark:text-emerald-400",
    wash: "bg-emerald-500/14 dark:bg-emerald-400/16",
    lit: "bg-emerald-500/[0.07] dark:bg-emerald-400/[0.09]",
    hairline: "bg-emerald-500/55 dark:bg-emerald-400/50",
    mark: "text-emerald-700 dark:text-emerald-300",
  },
  yellow: {
    idle: "border-yellow-500/25 bg-yellow-500/[0.06] text-yellow-900/80 dark:text-yellow-300/80",
    active: "border-yellow-500/45 bg-yellow-500/15 text-yellow-950 dark:text-yellow-200",
    icon: "text-yellow-600 dark:text-yellow-400",
    wash: "bg-yellow-500/14 dark:bg-yellow-400/14",
    lit: "bg-yellow-500/[0.07] dark:bg-yellow-400/[0.08]",
    hairline: "bg-yellow-600/50 dark:bg-yellow-400/45",
    mark: "text-yellow-800 dark:text-yellow-300",
  },
  cyan: {
    idle: "border-cyan-500/25 bg-cyan-500/[0.06] text-cyan-800/80 dark:text-cyan-300/80",
    active: "border-cyan-500/45 bg-cyan-500/15 text-cyan-900 dark:text-cyan-200",
    icon: "text-cyan-600 dark:text-cyan-400",
    wash: "bg-cyan-500/14 dark:bg-cyan-400/16",
    lit: "bg-cyan-500/[0.07] dark:bg-cyan-400/[0.09]",
    hairline: "bg-cyan-500/55 dark:bg-cyan-400/50",
    mark: "text-cyan-700 dark:text-cyan-300",
  },
  rose: {
    idle: "border-rose-500/25 bg-rose-500/[0.06] text-rose-800/80 dark:text-rose-300/80",
    active: "border-rose-500/45 bg-rose-500/15 text-rose-900 dark:text-rose-200",
    icon: "text-rose-600 dark:text-rose-400",
    wash: "bg-rose-500/14 dark:bg-rose-400/16",
    lit: "bg-rose-500/[0.07] dark:bg-rose-400/[0.09]",
    hairline: "bg-rose-500/55 dark:bg-rose-400/50",
    mark: "text-rose-700 dark:text-rose-300",
  },
};

/**
 * Soft ink CSS variable for an element — SVG presentation attributes bind to
 * these (see `app/global.css`). Never use Tailwind `fill-*` / `stroke-*` here:
 * those utilities are not in the Fumadocs preset build.
 *
 * @param preview - Element preview kind (`flow`, `signal`, …)
 */
export function elementToneVar(preview: ElementPreviewKind): string {
  return `var(--oke-el-${preview})`;
}

/**
 * Soft ink for an element by its display name (`Flow`, `Signal`, …).
 * Falls back to the theme foreground if the name is unknown.
 *
 * @param name - Element name from `ELEMENTS` / zoo concerns
 */
export function toneForElementName(name: string): string {
  const element = ELEMENTS.find((entry) => entry.name === name);
  return element ? elementToneVar(element.preview) : "var(--color-fd-foreground)";
}

/**
 * Lattice / Features Tailwind wash set for an element.
 *
 * @param preview - Element preview kind
 */
export function elementTone(preview: ElementPreviewKind) {
  return CHIP_TONE[ELEMENT_CHIP[preview]];
}
